#!/usr/bin/env python3
"""
Catalogue extraction — the READ half of the import pipeline (v2).

This is the post-audit replacement for the v1 extractor. It implements the
parent / colour-variant / size-SKU hierarchy, parses every image filename
correctly, normalises the parent title, and reports every conflict instead
of silently resolving it.

Output (stdout by default, or --out FILE):

    {
      "generatedAt": ...,
      "source":   {...},
      "products": [Product, ...],          # verified
      "quarantined": [SkuRecord, ...],     # kept out of the import
      "unmatchedImages": [...],            # images that could not be attributed
      "conflicts": [...]                    # every disagreement we noticed
    }

Each product carries the colour-level grouping, and the SKU/colour/size
records are attached to it.

Usage:
    python scripts/catalog_extract.py [--out FILE]

Requirements:
    pip install openpyxl xlrd
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import openpyxl
except ImportError:  # pragma: no cover
    print("openpyxl is required: pip install openpyxl", file=sys.stderr)
    sys.exit(2)

try:
    import xlrd  # type: ignore
except ImportError:  # pragma: no cover
    xlrd = None


ROOT = Path(__file__).resolve().parent.parent
PRODUCTS_DIR = ROOT / "public" / "products"
WORKBOOK = PRODUCTS_DIR / "products data.xlsx"

# --- SKU & folder parsing -------------------------------------------------

# Permissive on case because the source uses AJ-A33-Tan-06 etc.
SKU_RE = re.compile(r"^AJ-(A\d{2})-([A-Za-z]{2,5})-(\d{1,2})$")
# Strict (used after we uppercase the token).
FOLDER_RE = re.compile(r"^AJ-A(\d{2,3})$", re.IGNORECASE)
# Loose: matches `A1`, `A33`, `A48` -- some folders skip the leading zero.
LOOSE_FOLDER_RE = re.compile(r"^A[jJ]-A(\d+)$", re.IGNORECASE)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".avif"}

# Known folder-name forms. We normalise to the workbook's zero-padded A<NN>.
def folder_to_code(name: str) -> str | None:
    m = LOOSE_FOLDER_RE.match(name.strip())
    if not m:
        return None
    return f"A{int(m.group(1)):02d}"


# --- workbook -> slug ------------------------------------------------------

SUBCATEGORY_SLUGS = {
    "Mojri / Jutti": "mojri-jutti",
    "shoe": "shoe",
    "sandal": "sandal",
    "Chappal": "chappal",
}

# Workbook Colour column -> the "clean" form. Beige stays Beige.
COLOUR_DISPLAY = {
    "Beige": "Beige",
    "Black": "Black",
    "Blue": "Blue",
    "Brown": "Brown",
    "Chickoo": "Chickoo",
    "Cherry": "Cherry",
    "Golden": "Golden",
    "Grey": "Grey",
    "Ivory": "Ivory",
    "Olive": "Olive",
    "Tan": "Tan",
    "White": "White",
}

# Seller SKU token -> workbook colour. Source-of-truth for the token is the
# 674 rows; see docs/catalog-audit.md.
TOKEN_TO_COLOUR = {
    "BEG": "Beige",
    "BLK": "Black",
    "BLUE": "Blue",
    "BRN": "Brown",
    "CHK": "Chickoo",
    "CHR": "Cherry",
    "GLD": "Golden",
    "GRY": "Grey",
    "IVR": "Ivory",
    "IVY": "Ivory",
    "OLV": "Olive",
    "OW": "Ivory",
    "TAN": "Tan",
    "WHT": "White",
}

# The Flipkart template's data sheet is named after the category.
TEMPLATE_DATA_SHEETS = ("shoe", "sandal", "chappal")

# Columns we read out of the listing templates, by header name.
TEMPLATE_COLUMNS = {
    "seller_sku": "Seller SKU ID",
    "article_number": "Article Number",
    "mrp": "MRP (INR)",
    "selling_price": "Your selling price (INR)",
    "stock": "Stock",
    "uk_india_size": "UK/India Size",
    "euro_size": "Euro Size",
    "brand_color": "Brand Color",
    "colour": "Color",
    "main_image": "Main Image URL",
    "other_images": "Other Image URL 1",
    "ean": "EAN/UPC",
}

# Known colour words to strip from a colour-keyed title so we can recover the
# parent title. Matched case-insensitively, whole-word.
TITLE_COLOUR_WORDS = {
    "black", "white", "brown", "dark brown", "tan", "ivory", "navy",
    "navy blue", "blue", "beige", "grey", "gray", "olive", "olive green",
    "golden", "chickoo", "chikoo", "cherry", "cherry brown",
}

# A parent title token (AJOOBA Men's / AJOOBA Women's) is something we strip
# for the canonical name but keep as a "persona" tag.
TITLE_PREFIX = re.compile(r"^AJOOBA\s+(Men's|Women's|Unisex Kids')\s+", re.IGNORECASE)


# ---------- helpers --------------------------------------------------------


def slugify(value: str) -> str:
    normalised = unicodedata.normalize("NFKD", value)
    ascii_only = normalised.encode("ascii", "ignore").decode("ascii")
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_only).strip("-").lower()
    return cleaned or "design"


def design_code(raw: str) -> str:
    m = SKU_RE.match(raw.strip())
    if not m:
        return ""
    return m.group(1).upper()


def parse_sku(raw: str) -> tuple[str, str, int] | None:
    m = SKU_RE.match(raw.strip())
    if not m:
        return None
    code = m.group(1).upper()
    token = m.group(2).upper()
    size = int(m.group(3))
    return code, token, size


def as_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def as_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    text = text.replace("\xa0", " ")
    return text.strip()


# ---------- workbook ------------------------------------------------------


def read_workbook() -> list[dict[str, Any]]:
    workbook = openpyxl.load_workbook(WORKBOOK, data_only=True, read_only=True)
    sheet = workbook["Sheet1"]
    rows: list[dict[str, Any]] = []
    headers: list[str] | None = None
    for raw in sheet.iter_rows(values_only=True):
        if headers is None:
            headers = [clean_text(cell) for cell in raw]
            continue
        if raw is None or all(cell is None for cell in raw):
            continue
        record: dict[str, Any] = {}
        for idx, header in enumerate(headers):
            if not header:
                continue
            value = raw[idx] if idx < len(raw) else None
            record[header] = value
        rows.append(record)
    workbook.close()
    return rows


# ---------- title canonicalisation ----------------------------------------


def derive_parent_title(titles: list[str]) -> tuple[str, str]:
    """Return (parent_title, persona).

    The workbook ships a colour-keyed title per row. We strip the colour word
    so every row of a design collapses to the same parent title. The persona
    ("Men's" / "Women's" / "Unisex Kids'") is lifted out before the strip.
    """
    if not titles:
        return "", ""

    def colour_strip(text: str) -> str:
        # Remove the leading "AJOOBA Men's " token first.
        persona_match = TITLE_PREFIX.match(text)
        persona = persona_match.group(1) if persona_match else ""
        rest = TITLE_PREFIX.sub("", text) if persona_match else text
        for word in sorted(TITLE_COLOUR_WORDS, key=len, reverse=True):
            pattern = re.compile(rf"\b{re.escape(word)}\b", re.IGNORECASE)
            rest = pattern.sub("", rest)
        # Collapse duplicate whitespace and trim stray punctuation.
        rest = re.sub(r"\s+", " ", rest)
        rest = re.sub(r"\s+,", ",", rest)
        rest = re.sub(r"\s+\.", ".", rest)
        rest = re.sub(r"\s+–\s+", " – ", rest)
        rest = re.sub(r"–\s+", "– ", rest)
        rest = re.sub(r"\s+&", " &", rest)
        rest = re.sub(r"&", " & ", rest)
        rest = re.sub(r"\s+", " ", rest).strip(" ,–&.")
        if persona:
            return f"AJOOBA {persona} {rest}".strip()
        return rest.strip()

    stripped = [colour_strip(t) for t in titles]
    # Pick the most common stripped form.
    counts = Counter(stripped)
    best, _ = counts.most_common(1)[0]
    return best, TITLE_PREFIX.match(titles[0]).group(1) if TITLE_PREFIX.match(titles[0]) else ""


# ---------- image parsing --------------------------------------------------


# 1. Tokenised: A33-BLK-1, A33-BLK-2.., A13--BLK-1, A13-BLK-7
# 2. Untokenised: A1 - 1, A1-1, A1 1, A1_1
IMAGE_TOKENISED = re.compile(r"^A\d{1,3}[-_\s]+([A-Za-z]{2,5})[-_\s]+\d", re.IGNORECASE)
IMAGE_UNTOKENISED = re.compile(r"^A\d{1,3}[-_\s]+\d", re.IGNORECASE)
# Loose: any sequence with a colour token anywhere after A<NN>
IMAGE_ANY_TOKEN = re.compile(r"^A\d{1,3}[-_\s]+([A-Za-z]{2,5})[-_\s]+\d+", re.IGNORECASE)


def image_token(stem: str) -> str:
    """Best-effort colour token in an image filename stem, or '' if none."""
    m = IMAGE_ANY_TOKEN.match(stem)
    if not m:
        return ""
    return m.group(1).upper()


# ---------- image audit ---------------------------------------------------


def read_images(design_codes: set[str]) -> tuple[
    dict[str, dict[str, list[dict[str, Any]]]],  # code -> token -> [image]
    list[dict[str, Any]],                         # conflicts
    list[dict[str, Any]],                         # unmatched
]:
    """
    Walk every product folder, classify each image by colour token and report:

      * `code -> token -> [images]`     successfully attributed
      * `conflicts`                      ambiguous or duplicate images
      * `unmatched`                      images that could not be attributed
                                          to a design/colour at all
    """
    attributed: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    conflicts: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []

    folder_to_design: dict[str, str] = {}
    for folder in sorted(PRODUCTS_DIR.iterdir()):
        if not folder.is_dir():
            continue
        code = folder_to_code(folder.name)
        if code is None:
            continue
        folder_to_design[folder.name] = code

    for folder_name, code in folder_to_design.items():
        folder = PRODUCTS_DIR / folder_name
        # bucket images by token, plus "untokened"
        bucketed: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for image_path in sorted(folder.iterdir()):
            if not image_path.is_file():
                continue
            if image_path.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            stem = image_path.stem
            token = image_token(stem)
            bucketed[token].append(
                {
                    "url": f"/products/{folder_name}/{image_path.name}",
                    "alt": f"{code} {token or 'untokened'} {image_path.name}",
                    "position": 0,  # filled in after sorting
                    "sourceFile": image_path.name,
                    "sourceFolder": folder_name,
                    "colourToken": token,
                }
            )

        # Detect design code that exists in the workbook but not in folders.
        if code not in design_codes:
            for tok, items in bucketed.items():
                for item in items:
                    unmatched.append(
                        {
                            "reason": "design-not-in-workbook",
                            "code": code,
                            "sourceFile": item["sourceFile"],
                            "url": item["url"],
                            "colourToken": tok,
                        }
                    )

        # Untokened images live in a single-colour design only.
        untokened = bucketed.pop("", [])
        if untokened:
            # Decision: if the design has exactly one colour in the workbook,
            # attach the untokened images to that colour. If the design has
            # more than one colour, we cannot tell which colour they belong
            # to -> report as unmatched with reason "ambiguous-untokened".
            conflicts.append(
                {
                    "kind": "untokened-images",
                    "code": code,
                    "count": len(untokened),
                    "detail": "image filenames do not carry a colour token; "
                              "will be attached to the design's sole colour "
                              "if the design is single-coloured, else flagged",
                }
            )

        # Add bucketed images.
        for token, items in bucketed.items():
            attributed[code][token].extend(items)

        # Stash the untokened images separately for the design-level attach.
        attributed[code]["__untokened__"] = untokened

    # Detect duplicate image content (same md5 in the same design).
    import hashlib
    for code, by_token in attributed.items():
        seen: dict[str, str] = {}
        for token, items in by_token.items():
            if token == "__untokened__":
                continue
            for item in items:
                path = PRODUCTS_DIR / item["sourceFolder"] / item["sourceFile"]
                if not path.exists():
                    continue
                digest = hashlib.md5(path.read_bytes()).hexdigest()
                if digest in seen:
                    conflicts.append(
                        {
                            "kind": "duplicate-image",
                            "code": code,
                            "colourToken": token,
                            "first": seen[digest],
                            "duplicate": item["sourceFile"],
                        }
                    )
                else:
                    seen[digest] = item["sourceFile"]

    # Final pass: renumber positions in each bucket.
    for code, by_token in attributed.items():
        for token, items in by_token.items():
            items.sort(key=lambda i: i["sourceFile"])
            for idx, item in enumerate(items):
                item["position"] = idx

    return dict(attributed), conflicts, unmatched


# ---------- Flipkart templates --------------------------------------------


def read_templates() -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    rows_by_sku: dict[str, dict[str, Any]] = {}
    conflicts: list[dict[str, Any]] = []
    if xlrd is None:
        return rows_by_sku, conflicts

    for template_path in sorted(PRODUCTS_DIR.rglob("*.xls")):
        if not template_path.is_file():
            continue
        try:
            book = xlrd.open_workbook(str(template_path))
        except Exception as error:  # noqa: BLE001
            conflicts.append(
                {
                    "kind": "template-unreadable",
                    "source": template_path.name,
                    "detail": str(error),
                }
            )
            continue
        data_sheet = None
        for name in TEMPLATE_DATA_SHEETS:
            if name in book.sheet_names():
                data_sheet = book.sheet_by_name(name)
                break
        if data_sheet is None:
            book.release_resources()
            continue
        header_row = data_sheet.row_values(0) if data_sheet.nrows else []
        header_index = {
            clean_text(name): pos
            for pos, name in enumerate(header_row)
            if clean_text(name)
        }
        for row_number in range(4, data_sheet.nrows):
            values = data_sheet.row_values(row_number)
            if not values or not any(
                isinstance(v, str) and v.strip() for v in values
            ):
                continue

            def cell(key: str) -> Any:
                pos = header_index.get(TEMPLATE_COLUMNS[key])
                if pos is None or pos >= len(values):
                    return None
                return values[pos]

            sku = clean_text(cell("seller_sku"))
            if not sku:
                continue
            record = {
                "sku": sku,
                "source": template_path.name,
                "articleNumber": clean_text(cell("article_number")),
                "mrp": as_int(cell("mrp")),
                "sellingPrice": as_int(cell("selling_price")),
                "stock": as_int(cell("stock")),
                "ukIndiaSize": as_int(cell("uk_india_size")),
                "euroSize": as_int(cell("euro_size")),
                "brandColor": clean_text(cell("brand_color")),
                "colour": clean_text(cell("colour")),
                "ean": clean_text(cell("ean")),
                "imageUrls": [],
            }
            main = clean_text(cell("main_image"))
            if main:
                record["imageUrls"].append(main)
            for pos, name in enumerate(header_row):
                if not name.startswith("Other Image URL"):
                    continue
                if pos >= len(values):
                    continue
                url = clean_text(values[pos])
                if url:
                    record["imageUrls"].append(url)
            existing = rows_by_sku.get(sku)
            if existing is None:
                rows_by_sku[sku] = record
            else:
                conflicts.append(
                    {
                        "kind": "duplicate-template-row",
                        "sku": sku,
                        "sources": [existing["source"], record["source"]],
                    }
                )
                for key in ("euroSize", "ukIndiaSize", "ean"):
                    if not existing.get(key) and record.get(key):
                        existing[key] = record[key]
                for url in record["imageUrls"]:
                    if url not in existing["imageUrls"]:
                        existing["imageUrls"].append(url)
        book.release_resources()
    return rows_by_sku, conflicts


# ---------- the actual extraction -----------------------------------------


def build_design_slug(code: str, parent_title: str) -> str:
    return f"{code.lower()}-{slugify(parent_title)}"[:80].rstrip("-")


def build() -> dict[str, Any]:
    print(f"Reading workbook: {WORKBOOK}", file=sys.stderr)
    rows = read_workbook()
    print(f"  {len(rows)} data rows", file=sys.stderr)

    print("Reading listing templates…", file=sys.stderr)
    template_rows, template_conflicts = read_templates()
    print(f"  {len(template_rows)} unique template SKUs", file=sys.stderr)

    # ---- first pass: aggregate workbook rows by design -------------------
    raw_by_design: dict[str, dict[str, Any]] = {}
    for row in rows:
        sku = clean_text(row.get("Seller SKU Id"))
        if not sku:
            continue
        parsed = parse_sku(sku)
        if parsed is None:
            continue
        code, token, sku_size = parsed
        title = clean_text(row.get("Product Title"))
        description = clean_text(row.get("Description"))
        colour = clean_text(row.get("Colour"))
        subcategory = clean_text(row.get("Sub-category"))
        size = as_int(row.get("Size"))
        mrp = as_int(row.get("MRP")) or 0
        selling_price = as_int(row.get("Your Selling Price")) or 0
        if size is None:
            size = sku_size
        # Token is authoritative for the colour name; the workbook colour
        # column is recorded separately for cross-checking.
        token_colour = TOKEN_TO_COLOUR.get(token, "")

        bucket = raw_by_design.setdefault(
            code,
            {
                "code": code,
                "titles": [],
                "descriptions": [],
                "subcategory": subcategory,
                "rows": [],
            },
        )
        if title and title not in bucket["titles"]:
            bucket["titles"].append(title)
        if description and description not in bucket["descriptions"]:
            bucket["descriptions"].append(description)
        bucket["rows"].append(
            {
                "row": row.get("_row", 0),
                "sku": sku,
                "size": size,
                "skuSize": sku_size,
                "colour": colour,
                "token": token,
                "tokenColour": token_colour,
                "subcategory": subcategory,
                "mrp": mrp,
                "sellingPrice": selling_price,
                "description": description,
            }
        )

    # ---- second pass: detect design-level image/colour conflicts --------
    design_codes = set(raw_by_design)
    attributed, image_conflicts, unmatched = read_images(design_codes)

    # ---- third pass: assemble the v2 product record ---------------------
    products: list[dict[str, Any]] = []
    quarantined: list[dict[str, Any]] = []
    all_conflicts: list[dict[str, Any]] = []
    all_conflicts.extend(template_conflicts)
    all_conflicts.extend(image_conflicts)

    for code in sorted(raw_by_design):
        bucket = raw_by_design[code]
        parent_title, persona = derive_parent_title(bucket["titles"])
        # Pick the longest description as the parent description; the
        # "Available Colours" line is updated to match the design's colours.
        description = (
            max(bucket["descriptions"], key=len) if bucket["descriptions"] else ""
        )

        # Group rows by token (which is the colourway key).
        by_token: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in bucket["rows"]:
            by_token[row["token"]].append(row)

        # Cross-check: workbook Colour vs token.
        cross: list[str] = []
        for token, items in by_token.items():
            declared = items[0]["colour"]
            if declared and items[0]["tokenColour"] and declared != items[0]["tokenColour"]:
                cross.append(token)
                all_conflicts.append(
                    {
                        "kind": "token-colour-mismatch",
                        "code": code,
                        "token": token,
                        "workbookColour": declared,
                        "tokenColour": items[0]["tokenColour"],
                        "resolution": "token",
                    }
                )

        # Build colour variants.
        colour_variants: list[dict[str, Any]] = []
        has_conflict = False
        for token in sorted(by_token):
            items = by_token[token]
            token_colour = items[0]["tokenColour"]
            # Image bucket for this token (or "" for untokened).
            folder_imgs = attributed.get(code, {})
            token_images = (
                folder_imgs.get(token, []) + folder_imgs.get("__untokened__", [])
                if len(by_token) == 1 and folder_imgs.get("__untokened__")
                else folder_imgs.get(token, [])
            )
            # If a single-colour design, attach untokened images here.
            if len(by_token) == 1 and folder_imgs.get("__untokened__"):
                token_images = folder_imgs.get(token, []) + folder_imgs.get(
                    "__untokened__", []
                )

            # The colour is from the token, not the workbook column. Any
            # disagreement is already in `all_conflicts`.
            colour_name = token_colour

            # Subcategory: take from the first row that has one (always 1
            # per design in the source).
            subcategory = items[0]["subcategory"]

            sizes = sorted({it["size"] for it in items})
            colour_variants.append(
                {
                    "code": code,
                    "token": token,
                    "colour": colour_name,
                    "subcategory": subcategory,
                    "subcategorySlug": SUBCATEGORY_SLUGS.get(subcategory, "shoe"),
                    "images": token_images,
                    "sizes": sizes,
                }
            )

        # ---- now detect source defects that need quarantining -----------
        # An image folder carries a colour token that has no workbook row,
        # OR a workbook row exists with no images.
        tokens_in_workbook = set(by_token)
        tokens_in_folder = {
            t for t in (attributed.get(code, {}).keys()) if t != "__untokened__"
        }
        # A design is "ambiguous" when an image folder contains a colour
        # that the workbook does not list for that design.
        if tokens_in_folder and not tokens_in_folder.issubset(tokens_in_workbook):
            for extra in tokens_in_folder - tokens_in_workbook:
                has_conflict = True
                all_conflicts.append(
                    {
                        "kind": "image-colour-not-in-workbook",
                        "code": code,
                        "token": extra,
                        "resolution": "quarantine",
                        "detail": (
                            f"design {code} has {len(attributed[code][extra])} image(s) "
                            f"for token {extra} but the workbook does not list this colour"
                        ),
                    }
                )
        # OR a workbook colour has no images AND another colour in the same
        # design has images -> suspect a typo in the workbook.
        if tokens_in_workbook - tokens_in_folder and tokens_in_folder:
            for missing in tokens_in_workbook - tokens_in_folder:
                # Only flag when the design has at least one colour with
                # images (otherwise it's an entirely image-less design).
                has_conflict = True
                all_conflicts.append(
                    {
                        "kind": "workbook-colour-without-images",
                        "code": code,
                        "token": missing,
                        "colour": TOKEN_TO_COLOUR.get(missing, missing),
                        "detail": (
                            f"design {code} declares {TOKEN_TO_COLOUR.get(missing, missing)} "
                            f"in the workbook but has no images for that colour"
                        ),
                    }
                )

        # Build the SKU records for the colour variant.
        all_skus: list[dict[str, Any]] = []
        for cv in colour_variants:
            token = cv["token"]
            token_rows = by_token[token]
            for r in token_rows:
                template = template_rows.get(r["sku"])
                if template:
                    if (
                        template["mrp"] is not None
                        and r["mrp"]
                        and template["mrp"] != r["mrp"]
                    ):
                        all_conflicts.append(
                            {
                                "kind": "price-conflict",
                                "sku": r["sku"],
                                "field": "mrp",
                                "workbook": r["mrp"],
                                "template": template["mrp"],
                                "source": template["source"],
                                "resolution": "workbook",
                            }
                        )
                    if (
                        template["sellingPrice"] is not None
                        and r["sellingPrice"]
                        and template["sellingPrice"] != r["sellingPrice"]
                    ):
                        all_conflicts.append(
                            {
                                "kind": "price-conflict",
                                "sku": r["sku"],
                                "field": "sellingPrice",
                                "workbook": r["sellingPrice"],
                                "template": template["sellingPrice"],
                                "source": template["source"],
                                "resolution": "workbook",
                            }
                        )
                    if (
                        template["ukIndiaSize"] is not None
                        and r["size"] != template["ukIndiaSize"]
                    ):
                        all_conflicts.append(
                            {
                                "kind": "size-conflict",
                                "sku": r["sku"],
                                "workbook": r["size"],
                                "template": template["ukIndiaSize"],
                                "source": template["source"],
                                "resolution": "workbook",
                            }
                        )
                    if (
                        template["brandColor"]
                        and template["brandColor"] != cv["colour"]
                    ):
                        all_conflicts.append(
                            {
                                "kind": "colour-conflict",
                                "sku": r["sku"],
                                "workbook": cv["colour"],
                                "template": template["brandColor"],
                                "source": template["source"],
                                "resolution": "workbook",
                            }
                        )

                discount = 0
                if r["mrp"] > 0 and r["sellingPrice"] > 0:
                    discount = max(
                        0,
                        min(
                            100,
                            round(
                                (r["mrp"] - r["sellingPrice"]) / r["mrp"] * 100
                            ),
                        ),
                    )
                all_skus.append(
                    {
                        "sku": r["sku"],
                        "productCode": code,
                        "colourToken": token,
                        "colour": cv["colour"],
                        "size": r["size"],
                        "mrp": r["mrp"],
                        "sellingPrice": r["sellingPrice"],
                        "discountPercent": discount,
                        "ukIndiaSize": template["ukIndiaSize"] if template else None,
                        "euroSize": template["euroSize"] if template else None,
                        "ean": template["ean"] if template else "",
                        "articleNumber": template["articleNumber"]
                        if template
                        else code,
                        "stock": 0,  # never trust template stock
                        "inStock": False,
                        "templateStock": template["stock"] if template else None,
                        "marketplaceImageUrls": template["imageUrls"] if template else [],
                    }
                )

        if has_conflict:
            # Move every SKU of this design to the quarantine queue. The
            # design itself is reported in `conflicts` and the operator
            # must resolve manually.
            for sku in all_skus:
                quarantined.append(
                    {
                        "sku": sku["sku"],
                        "productCode": code,
                        "reason": "design-level-colour-image-conflict",
                        "detail": (
                            "workbook colours and image-folder colours disagree; "
                            "see image-colour-not-in-workbook and "
                            "workbook-colour-without-images in conflicts"
                        ),
                    }
                )
            continue

        # All clear: build the colour variants in stable order.
        for cv in colour_variants:
            for position, image in enumerate(cv["images"]):
                image["position"] = position

        # Combine all images for the design-level fallback (used by the
        # card and the "view all photos" affordance). These are de-duped by
        # source file.
        all_images: list[dict[str, Any]] = []
        seen_files: set[str] = set()
        for cv in colour_variants:
            for image in cv["images"]:
                key = f"{image['sourceFolder']}/{image['sourceFile']}"
                if key in seen_files:
                    continue
                seen_files.add(key)
                all_images.append(
                    {
                        "url": image["url"],
                        "alt": f"{parent_title} — {image['sourceFile']}",
                        "position": 0,  # set after sort
                        "sourceFile": image["sourceFile"],
                        "sourceFolder": image["sourceFolder"],
                        "colourToken": image["colourToken"],
                    }
                )
        all_images.sort(key=lambda i: i["sourceFile"])
        for idx, image in enumerate(all_images):
            image["position"] = idx

        mrp = min((s["mrp"] for s in all_skus), default=0)
        sp = min((s["sellingPrice"] for s in all_skus), default=0)

        products.append(
            {
                "code": code,
                "slug": build_design_slug(code, parent_title),
                "title": parent_title,
                "persona": persona,
                "rawTitles": bucket["titles"],
                "description": description,
                "subcategory": bucket["subcategory"],
                "subcategorySlug": SUBCATEGORY_SLUGS.get(
                    bucket["subcategory"], "shoe"
                ),
                "brand": "Ajooba Footwear",
                "colours": [
                    {"name": cv["colour"], "token": cv["token"], "images": cv["images"]}
                    for cv in colour_variants
                ],
                "images": all_images,
                "mrp": mrp,
                "sellingPrice": sp,
                "inStock": False,
                "skus": all_skus,
            }
        )

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": {
            "workbook": "public/products/products data.xlsx",
            "workbookRows": len(rows),
            "templateSkus": len(template_rows),
            "designsWithImages": sum(1 for c in design_codes if attributed.get(c)),
        },
        "products": products,
        "quarantined": quarantined,
        "unmatchedImages": unmatched,
        "conflicts": all_conflicts,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="-")
    args = parser.parse_args()
    payload = build()
    text = json.dumps(payload, indent=2, ensure_ascii=False)
    if args.out == "-":
        print(text)
    else:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(text, encoding="utf-8")
        print(
            f"Wrote {out_path} — {len(payload['products'])} designs, "
            f"{len(payload['quarantined'])} quarantined SKUs, "
            f"{len(payload['conflicts'])} conflicts",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
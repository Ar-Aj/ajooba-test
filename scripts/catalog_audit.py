#!/usr/bin/env python3
"""
Catalogue audit — re-runnable verification of the source catalogue.

This script reads the ORIGINAL source assets read-only and prints the
findings that are recorded in `docs/catalog-audit.md`. It never writes to
`public/`.

Usage:
    python scripts/catalog_audit.py

Requirements:
    pip install openpyxl xlrd
"""

from __future__ import annotations

import hashlib
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

try:
    import openpyxl
except ImportError:  # pragma: no cover
    print("openpyxl is required: pip install openpyxl", file=sys.stderr)
    sys.exit(2)

ROOT = Path(__file__).resolve().parent.parent
WORKBOOK = ROOT / "public" / "products" / "products data.xlsx"
PRODUCTS_DIR = ROOT / "public" / "products"

SKU_RE = re.compile(r"^AJ-(A\d{2})-([A-Z]+)-(\d{2})$")
STRICT_SKU_RE = re.compile(r"^AJ-(A\d{2})-([A-Z]{2,5})-(\d{2})$")


def md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_rows() -> list[dict]:
    workbook = openpyxl.load_workbook(WORKBOOK, read_only=True, data_only=True)
    sheet = workbook[workbook.sheetnames[0]]
    rows = list(sheet.iter_rows(values_only=True))
    header = [str(cell).strip() if cell is not None else "" for cell in rows[0]]
    records = []
    for raw in rows[1:]:
        if all(cell is None for cell in raw):
            continue
        records.append(dict(zip(header, raw)))
    workbook.close()
    return records


def main() -> int:
    if not WORKBOOK.exists():
        print(f"Workbook not found: {WORKBOOK}", file=sys.stderr)
        return 1

    rows = load_rows()
    print("=" * 72)
    print("AJOBA FOOTWEAR - CATALOGUE AUDIT")
    print("=" * 72)
    print(f"Workbook      : {WORKBOOK.relative_to(ROOT)}")
    print(f"Data rows     : {len(rows)}")
    print(f"Columns       : {', '.join(rows[0].keys()) if rows else '(none)'}")
    print()

    # --- SKUs, designs, subcategories, colours, sizes ---------------------
    skus: list[str] = []
    designs: set[str] = set()
    subcats: Counter[str] = Counter()
    colours: Counter[str] = Counter()
    sizes: Counter[int] = Counter()
    colour_tokens: Counter[str] = Counter()
    malformed: list[str] = []
    mrp_selling_pairs: Counter[tuple[float, float]] = Counter()
    price_conflicts: list[dict] = []

    for row in rows:
        sku = str(row.get("Seller SKU Id") or "").strip()
        if not sku:
            continue
        skus.append(sku)
        match = STRICT_SKU_RE.match(sku)
        if match:
            design_code, token, _size = match.group(1), match.group(2), match.group(3)
            designs.add(design_code)
            colour_tokens[token] += 1
        else:
            malformed.append(sku)
            # Still extract the design code and token for reporting purposes.
            loose = re.match(r"^AJ-(A\d{2})-([A-Za-z]+)-(\d{2})$", sku)
            if loose:
                designs.add(loose.group(1))
                colour_tokens[loose.group(2).upper()] += 1

        subcats[str(row.get("Sub-category") or "").strip()] += 1
        colours[str(row.get("Colour") or "").strip()] += 1
        try:
            sizes[int(row.get("Size"))] += 1
        except (TypeError, ValueError):
            pass

        try:
            mrp = float(row.get("MRP") or 0)
            selling = float(row.get("Your Selling Price") or 0)
        except (TypeError, ValueError):
            continue
        mrp_selling_pairs[(mrp, selling)] += 1

    print("DESIGNS")
    print(f"  distinct A<NN> codes : {len(designs)}")
    print(f"  total Seller SKUs    : {len(skus)}")
    print(f"  unique Seller SKUs   : {len(set(skus))}")
    print(f"  strict-pattern SKUs  : {len(skus) - len(malformed)}")
    print(f"  non-standard SKUs    : {len(malformed)}")
    for sku in malformed:
        print(f"    {sku}")
    print()

    print("SUB-CATEGORIES (raw values, verbatim)")
    for value, count in subcats.most_common():
        print(f"  {value!r:24} {count:>5}")
    print()

    print("COLOURS (raw values, verbatim)")
    for value, count in colours.most_common():
        print(f"  {value!r:12} {count:>5}")
    print()

    print("COLOUR TOKENS (from Seller SKU Id)")
    for value, count in colour_tokens.most_common():
        print(f"  {value:6} {count:>5}")
    print()

    print("SIZES")
    for size, count in sorted(sizes.items()):
        print(f"  {size:>3} {count:>5}")
    print()

    # --- Price conflicts ---------------------------------------------------
    by_sku: dict[str, dict] = {}
    for row in rows:
        sku = str(row.get("Seller SKU Id") or "").strip()
        if sku:
            by_sku.setdefault(sku, row)

    # --- Image assets -------------------------------------------------------
    print("IMAGE ASSETS")
    ext_counts: Counter[str] = Counter()
    dir_counts: Counter[str] = Counter()
    hashes: defaultdict[str, list[str]] = defaultdict(list)
    total_bytes = 0
    image_files: list[Path] = []

    public_root = ROOT / "public"
    for dirpath, _dirnames, filenames in os.walk(public_root):
        rel_dir = os.path.relpath(dirpath, public_root).replace("\\", "/")
        for filename in filenames:
            path = Path(dirpath) / filename
            ext_counts[path.suffix.lower()] += 1
            dir_counts[rel_dir] += 1
            total_bytes += path.stat().st_size
            if path.suffix.lower() in {".jpg", ".jpeg", ".png"}:
                image_files.append(path)

    for path in image_files:
        hashes[md5(path)].append(str(path.relative_to(ROOT)).replace("\\", "/"))

    duplicate_groups = {h: paths for h, paths in hashes.items() if len(paths) > 1}
    duplicate_files = sum(len(paths) for paths in duplicate_groups.values())

    for ext, count in sorted(ext_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {ext or '(none)':8} {count:>5}")
    print(f"  TOTAL FILES : {sum(ext_counts.values())}")
    print(f"  TOTAL SIZE  : {total_bytes / 1024 / 1024:.1f} MB")
    print(f"  unique image hashes : {len(hashes)}")
    print(f"  duplicate image files: {duplicate_files} "
          f"(in {len(duplicate_groups)} identical groups)")
    for digest, paths in duplicate_groups.items():
        print(f"    {digest[:12]}  {paths}")
    print()

    print("FILES PER TOP-LEVEL DIRECTORY")
    for directory, count in sorted(dir_counts.items(), key=lambda kv: -kv[1]):
        print(f"  {directory:22} {count:>5}")
    print()

    # --- Design folders vs designs -----------------------------------------
    # NOTE: the workbook uses zero-padded design codes (A01) while the image
    # folders do not (AJ-A1). The match must be numeric, not textual.
    def folder_to_design(name: str) -> str | None:
        match = re.match(r"^A[jJ]-(A\d+)$", name)
        if not match:
            return None
        return f"A{int(match.group(1)[1:]):02d}"

    folder_map: dict[str, str | None] = {
        d.name: folder_to_design(d.name)
        for d in PRODUCTS_DIR.iterdir()
        if d.is_dir()
    }
    unparsed = sorted(name for name, code in folder_map.items() if code is None)
    matched_designs = {code for code in folder_map.values() if code}

    print("DESIGN FOLDERS")
    print(f"  folders under public/products      : {len(folder_map)}")
    print(f"  folders that fail to parse          : {len(unparsed)} {unparsed}")
    print(f"  designs in the workbook             : {len(designs)}")
    print(f"  designs WITH a folder               : {len(matched_designs)}")
    missing_dirs = sorted(designs - matched_designs)
    if missing_dirs:
        print(f"  designs WITHOUT a folder            : {len(missing_dirs)} {missing_dirs}")
    orphan_folders = sorted(matched_designs - designs)
    if orphan_folders:
        print(f"  folders with NO matching design     : {len(orphan_folders)} {orphan_folders}")
    print("  NOTE: workbook codes are zero-padded (A01); folders are not (AJ-A1).")
    print("        The match is numeric, not textual.")
    print()

    print("=" * 72)
    print("SUMMARY")
    print(f"  {len(designs)} designs, {len(set(skus))} unique SKUs")
    print(f"  {len(subcats)} raw sub-categories, {len(colours)} raw colours")
    print(f"  sizes {sorted(sizes)}")
    print(f"  {sum(ext_counts.values())} asset files ({total_bytes / 1024 / 1024:.1f} MB)")
    print("=" * 72)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
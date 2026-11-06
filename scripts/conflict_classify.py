#!/usr/bin/env python3
"""
Conflict classifier — sizes the catalogue's unresolvable rows.

This is the READ-ONLY companion to `catalog_extract.py` and
`catalog-import.job.ts`. It answers one question:

    **How much of the catalogue is safe to import today, and how much is
    blocked on a business decision?**

The import pipeline refuses to guess. Where the workbook and the Flipkart
listing templates disagree on price, size or colour, the row is reported
rather than resolved. That is the right default, but it leaves an operator
with an unhelpful answer — "502 conflicts" does not say what is actually
shippable.

This script answers that by splitting the conflicts into two very different
categories:

* **Data conflicts** — two sources disagree on a value. A human has to choose.
  These block a row from being imported.
* **Media gaps** — a colour variant has no photography. Nothing disagrees;
  the content simply does not exist. These do not block an import, but they
    do make the variant unsellable.

Usage:

    python scripts/conflict_classify.py
    python scripts/conflict_classify.py --extract artifacts/catalog-extract.json

Reads only the extract payload. Writes nothing. Touches no source asset.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

DEFAULT_PAYLOAD = Path("artifacts/catalog-extract.json")

# ---------------------------------------------------------------------------
# Conflict taxonomy
# ---------------------------------------------------------------------------

# Two sources disagree on a value the platform stores. A human must choose.
DATA_KINDS = frozenset(
    {
        "price-conflict",
        "size-conflict",
        "colour-conflict",
        "duplicate-template-row",
        "unparseable-sku",
    }
)

# The content is missing. Nothing disagrees with anything.
MEDIA_KINDS = frozenset(
    {
        "colour-without-images",
        "untokened-images-multi-colour",
        "missing-image-folder",
        "template-unreadable",
    }
)

# Blocks the whole design rather than a single variant.
DESIGN_KINDS = frozenset({"missing-image-folder", "untokened-images-multi-colour"})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load(payload_path: Path) -> dict[str, Any]:
    if not payload_path.exists():
        raise SystemExit(
            f"Extract payload not found at {payload_path}.\n"
            "Run `pnpm catalog:extract` first."
        )
    with payload_path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _index_conflicts(
    conflicts: list[dict[str, Any]],
) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """Group conflict kinds by the SKU and by the design they attach to."""
    by_sku: dict[str, list[str]] = defaultdict(list)
    by_code: dict[str, list[str]] = defaultdict(list)

    for conflict in conflicts:
        kind = conflict.get("kind", "unknown")
        sku = conflict.get("sku")
        code = conflict.get("code")

        if sku:
            by_sku[sku].append(kind)
        if code:
            by_code[code].append(kind)

    return by_sku, by_code


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------


def report(payload: dict[str, Any]) -> None:
    products: list[dict[str, Any]] = payload["products"]
    conflicts: list[dict[str, Any]] = payload["conflicts"]
    all_skus = {variant["sku"] for product in products for variant in product["variants"]}

    by_sku, by_code = _index_conflicts(conflicts)

    data_skus = {sku for sku, kinds in by_sku.items() if DATA_KINDS.intersection(kinds)}
    data_codes = {code for code, kinds in by_code.items() if DATA_KINDS.intersection(kinds)}
    media_codes = {
        code
        for code, kinds in by_code.items()
        if MEDIA_KINDS.intersection(kinds) and code not in data_codes
    }
    blocked_codes = {
        code for code, kinds in by_code.items() if DESIGN_KINDS.intersection(kinds)
    }

    print("=" * 66)
    print("CONFLICT KINDS")
    print("=" * 66)
    for kind, count in Counter(c.get("kind") for c in conflicts).most_common():
        print(f"{count:6d}  {kind}")
    print(f"{len(conflicts):6d}  TOTAL")

    print()
    print("=" * 66)
    print("WHAT IS IMPORTABLE TODAY")
    print("=" * 66)

    total_variants = 0
    total_images = 0
    clean_variants = 0
    clean_designs = 0
    partial_designs = 0
    clean_images = 0

    for product in products:
        code = product["code"]
        variants = product["variants"]
        images = product["images"]

        total_variants += len(variants)
        total_images += len(images)

        unblocked_here = [v for v in variants if v["sku"] not in data_skus]
        clean_variants += len(unblocked_here)

        # A design-level conflict blocks every variant under it: a design with
        # no image folder or ambiguous filenames is not importable cleanly
        # even if each individual SKU's values are agreed.
        if code in data_codes or code in blocked_codes:
            continue

        if len(unblocked_here) == len(variants):
            clean_designs += 1
            clean_images += len(images)
        else:
            partial_designs += 1

    conflicted_variants = len(data_skus & all_skus)
    print(f"designs total           {len(products):6d}")
    print(f"  fully conflict-free   {clean_designs:6d}")
    print(f"  partly conflicted     {partial_designs:6d}")
    print(f"  blocked entirely      {len(products) - clean_designs - partial_designs:6d}")
    print()
    print(f"variants total          {total_variants:6d}")
    print(f"  verified clean        {clean_variants:6d}")
    print(f"  blocked on a decision {conflicted_variants:6d}")
    print()
    print(f"images on clean designs {clean_images:6d}  of {total_images}")

    print()
    print("=" * 66)
    print("WHAT IS BLOCKED, AND ON WHAT")
    print("=" * 66)

    print()
    print("designs blocked on a source disagreement:")
    print(f"  {sorted(data_codes) or '(none)'}")
    print()
    print("designs with a media gap only (importable, but unsellable):")
    print(f"  {sorted(media_codes) or '(none)'}")

    print()
    print("per-kind SKU spread (catalogue SKUs only):")
    for kind in sorted(DATA_KINDS | MEDIA_KINDS):
        count = sum(1 for sku, kinds in by_sku.items() if kind in kinds and sku in all_skus)
        codes = sum(1 for code, kinds in by_code.items() if kind in kinds)
        if count or codes:
            print(f"  {kind:32s} skus={count:5d}  designs={codes:4d}")

    # A conflict is an *event*, not a product. One SKU can disagree with the
    # templates on price, colour and size simultaneously, so summing the
    # per-kind counts would triple-count it. Report the overlap explicitly.
    combinations = Counter(
        frozenset(DATA_KINDS.intersection(kinds))
        for sku, kinds in by_sku.items()
        if sku in all_skus and DATA_KINDS.intersection(kinds)
    )

    print()
    print("=" * 66)
    print("WHY THE PER-KIND TOTALS EXCEED THE BLOCKED COUNT")
    print("=" * 66)
    print(f"  blocked variants:      {len(data_skus.intersection(all_skus))}")
    print(f"  sum of per-kind counts: {sum(len(k) for k in combinations.elements())}")
    print()
    for kinds, count in combinations.most_common():
        listed = ", ".join(sorted(kinds))
        print(f"  {count:4d}  {listed}")

    print()
    print("=" * 66)
    print("DECISIONS REQUIRED (see docs/CATALOG_CONFLICTS.md)")
    print("=" * 66)
    for kind in sorted(DATA_KINDS):
        skus = sorted({sku for sku, k in by_sku.items() if kind in k} & all_skus)
        if skus:
            sample = ", ".join(skus[:3])
            more = f" (+{len(skus) - 3} more)" if len(skus) > 3 else ""
            print(f"  {kind:24s} {len(skus):4d} SKUs   e.g. {sample}{more}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--extract",
        type=Path,
        default=DEFAULT_PAYLOAD,
        help="Path to the extract payload (default: %(default)s)",
    )
    args = parser.parse_args()

    report(_load(args.extract))


if __name__ == "__main__":
    main()
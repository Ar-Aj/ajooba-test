import type { Product, ProductImage, ProductVariant } from '@ajooba/contracts';

/**
 * Colour helpers shared by the homepage tiles and the Jukebox.
 *
 * ## Why a swatch hex exists at all
 *
 * The catalogue's colour names are the workbook's own words (`Chickoo`,
 * `Cherry`, `Olive`). A dot is never the evidence of a colour — the photograph
 * is — so every swatch below is paired with a photograph of that exact
 * colourway wherever it is shown. The hex is only the small, fast cue a shopper
 * scans before the picture changes.
 *
 * Unknown names (a colour an administrator adds later) fall back to a neutral
 * stone tone rather than a guess, and still render their name.
 */
const SWATCH_HEX: Record<string, string> = {
  beige: '#d8c3a0',
  black: '#1c1c1e',
  blue: '#2d4a7c',
  brown: '#5b3a26',
  chickoo: '#9c7457',
  cherry: '#6d1f2c',
  golden: '#c9a24a',
  gold: '#c9a24a',
  grey: '#8b8e93',
  gray: '#8b8e93',
  ivory: '#efe7d3',
  olive: '#5e5c32',
  tan: '#b27c48',
  white: '#f7f6f1',
};

const FALLBACK_HEX = '#a8a294';

/** A display hex for a catalogue colour name. */
export function swatchHex(colour: string): string {
  return SWATCH_HEX[colour.trim().toLowerCase()] ?? FALLBACK_HEX;
}

/** Relative luminance (0 = black, 1 = white) of a `#rrggbb` hex. */
export function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channel = (offset: number) => {
    const c = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** True when a swatch is light enough to need a visible outline on cream. */
export function isLightSwatch(hex: string): boolean {
  return luminance(hex) > 0.6;
}

/** One colourway of a design, with the photographs and sizes that belong to it. */
export interface Colourway {
  readonly colour: string;
  readonly hex: string;
  readonly images: readonly ProductImage[];
  /** One variant per size, sorted ascending. */
  readonly sizes: readonly ProductVariant[];
  readonly inStock: boolean;
  readonly sellingPrice: number;
  readonly mrp: number;
}

/**
 * For each size, keep one representative variant — in stock first, then the
 * lowest price. Mirrors the PDP buy box so both surfaces show the same sizes.
 */
export function dedupeBySize(variants: readonly ProductVariant[]): ProductVariant[] {
  const bySize = new Map<number, ProductVariant>();
  for (const variant of variants) {
    const existing = bySize.get(variant.size);
    if (!existing) {
      bySize.set(variant.size, variant);
      continue;
    }
    const better =
      (variant.inStock && !existing.inStock) ||
      (variant.inStock === existing.inStock && variant.sellingPrice < existing.sellingPrice);
    if (better) bySize.set(variant.size, variant);
  }
  return [...bySize.values()].sort((a, b) => a.size - b.size);
}

/**
 * The colourways of a design, in the catalogue's own colour order.
 *
 * Only colours with at least one verified photograph are returned. A colour
 * whose photography is still in review is not offered, for the same reason the
 * PDP withholds it: a shopper must never pick a colour on the strength of a
 * picture that belongs to another one.
 */
export function colourwaysOf(product: Product): Colourway[] {
  return product.colours
    .map((colour) => {
      const images = product.images
        .filter((image) => image.colour === colour)
        .sort((a, b) => a.position - b.position);
      const variants = product.variants.filter((variant) => variant.colour === colour);
      const sizes = dedupeBySize(variants);
      const priced = variants.length > 0 ? variants : product.variants;
      const cheapest = priced.reduce<ProductVariant | undefined>(
        (best, variant) => (!best || variant.sellingPrice < best.sellingPrice ? variant : best),
        undefined,
      );
      return {
        colour,
        hex: swatchHex(colour),
        images,
        sizes,
        inStock: variants.some((variant) => variant.inStock),
        sellingPrice: cheapest?.sellingPrice ?? product.sellingPrice,
        mrp: cheapest?.mrp ?? product.mrp,
      };
    })
    .filter((colourway) => colourway.images.length > 0);
}

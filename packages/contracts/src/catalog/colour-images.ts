/**
 * Colour → image resolution.
 *
 * ## Why this exists
 *
 * A product design is photographed into one flat asset folder. The colour a
 * photo belongs to is encoded in its filename (`A46-BRN-2.png`), but that
 * encoding is **not reliable across the whole catalogue**:
 *
 * - Some filenames carry no colour token at all (`A1 - 1.jpg`, `A10-7.jpg`).
 * - Some carry a token that contradicts the workbook — `A46-Tan-1.jpeg` on a
 *   design whose variants are Black/Brown/Tan is fine, but `A48-IVY-*.png` on a
 *   design sold as Beige/Grey is not.
 * - Some carry a token for a colour the design does not sell — `A14-WHT-*` on
 *   a design whose variant colours are Black/Brown/Tan/White is fine, but
 *   `A30-TAN-*` on a design sold only as Black/Brown is a genuine mismatch.
 *
 * The storefront gallery is keyed on the **selected colour**, so an image must
 * never be shown for a colour it does not belong to. Guessing here is what
 * produces "I picked Black and saw a brown shoe".
 *
 * ## The rule (Option A)
 *
 * An image is assigned to a colour **only when its filename token matches a
 * colour token that the design actually sells**. Everything else is
 * *quarantined*: it stays on disk, keeps its `sourceFile`, and is recorded in
 * the review queue — but it is not assigned to a colour and not displayed.
 *
 * Two exceptions, both evidence-based rather than guessed:
 *
 * 1. **Single-colour designs.** A design that sells exactly one colour cannot
 *    be mis-shown by assigning its images to that colour, and there is no
 *    competing colour for the images to be confused with. All of its images
 *    are kept.
 * 2. **Untokened filenames on a single-colour design.** Same reasoning; the
 *    token is absent but there is nothing to contradict.
 *
 * This module is deliberately pure and dependency-free so that the importer
 * (Node), the API service (Node) and the storefront (browser) all resolve
 * galleries by exactly the same rule.
 */

import type { ColourToken } from './types.js';

/** The outcome of inspecting one image. */
export type ImageColourResolution =
  /**
   * The token matched a colour this design sells. Displayable in that colour.
   * The colour is a `string` (not the narrowed `ColourRaw`) because the source
   * data — the workbook, the variant rows, the import — is structurally a
   * `string` until the API's Zod schemas narrow it on the way out.
   */
  | { readonly kind: 'assigned'; readonly colour: string; readonly token: ColourToken | null }
  /** No token in the filename, and the design sells more than one colour. */
  | { readonly kind: 'unverified'; readonly reason: 'untokened'; readonly token: null }
  /** A token was found but it names a colour this design does not sell. */
  | {
      readonly kind: 'unverified';
      readonly reason: 'token-not-sold';
      readonly token: string;
    }
  /** The filename did not match the expected `A<NN>-<TOKEN>-<N>.ext` shape. */
  | { readonly kind: 'unverified'; readonly reason: 'unparsable'; readonly token: null };

/**
 * Matches the source-asset filename convention, e.g. `A46-BRN-2.png`,
 * `A48-GRY-1.png`, `A18-Tan-4.jpeg`.
 *
 * The design number is matched loosely (`A1` and `A01` both occur) because the
 * folder names were hand-made without zero padding — see
 * docs/CATALOG_CONFLICTS.md §5. Casing is deliberately case-insensitive
 * because the source mixes `Tan` and `TAN`.
 */
const TOKENISED_FILENAME = /^A\d{1,2}[-_ ]([A-Za-z]{2,4})[-_ ]\d+\.[A-Za-z0-9]+$/;

/**
 * Extract the raw colour token from a source filename, upper-cased.
 *
 * Returns `null` when the filename carries no token (`A1 - 1.jpg`) or does not
 * match the convention at all.
 */
export function extractColourToken(sourceFile: string): string | null {
  const match = TOKENISED_FILENAME.exec(sourceFile);
  if (!match?.[1]) return null;
  return match[1].toUpperCase();
}

/**
 * Build the token → colour map for a design from its variants.
 *
 * The variant colour is the authority here, not the filename: the workbook
 * decides what a design is *sold* in, the folder decides what it was
 * *photographed* in. Where a design has one colour sold under two different
 * tokens (`Ivory` appears as `OW`, `IVY` and `IVR`), every token maps to the
 * same colour, so a photo filed under either spelling is still correct.
 */
export function buildColourTokenMap(
  variants: ReadonlyArray<{ readonly colour: string; readonly colourToken: string }>,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const variant of variants) {
    const token = variant.colourToken.trim().toUpperCase();
    if (!token) continue;
    // First writer wins: the catalogue is consistent within a design, and if it
    // ever is not, the earliest variant is as authoritative as any.
    if (!map.has(token)) map.set(token, variant.colour);
  }
  return map;
}

/**
 * Decide which colour (if any) an image belongs to.
 *
 * @param sourceFile the asset filename exactly as it exists on disk
 * @param tokenMap   token → colour, built from the design's own variants
 * @param soldColours the human colour names this design sells
 */
export function resolveImageColour(
  sourceFile: string,
  tokenMap: ReadonlyMap<string, string>,
  soldColours: readonly string[],
): ImageColourResolution {
  const token = extractColourToken(sourceFile);

  /*
   * Evidence-based exception: a design sold in exactly one colour cannot show
   * the wrong colour, because there is no other colour it could be confused
   * with. Keep the images regardless of whether the token parses.
   */
  if (soldColours.length === 1) {
    if (token && tokenMap.get(token)) {
      return { kind: 'assigned', colour: tokenMap.get(token)!, token: token as ColourToken };
    }
    return { kind: 'assigned', colour: soldColours[0]!, token: null };
  }

  if (!token) {
    return { kind: 'unverified', reason: 'untokened', token: null };
  }

  const colour = tokenMap.get(token);
  if (!colour) {
    return { kind: 'unverified', reason: 'token-not-sold', token };
  }

  return { kind: 'assigned', colour, token: token as ColourToken };
}

/** A product gallery grouped by colour, plus whatever could not be verified. */
export interface ColourGalleries {
  /** Human colour name → the images verified as belonging to it, in order. */
  readonly byColour: ReadonlyMap<string, readonly string[]>;
  /**
   * Images that could not be verified, kept for the review queue. Each entry is
   * the original `sourceFile` — the image itself is never deleted.
   */
  readonly quarantined: readonly string[];
  /** True when at least one image was quarantined for this design. */
  readonly hasQuarantine: boolean;
}

/**
 * Group a design's images into per-colour galleries, quarantining any image
 * whose colour cannot be verified.
 *
 * Input is a flat list of `{ sourceFile, url, position }`; output is the
 * colour → urls mapping the storefront gallery consumes.
 */
export function buildColourGalleries(
  images: ReadonlyArray<{ readonly sourceFile: string; readonly url: string }>,
  tokenMap: ReadonlyMap<string, string>,
  soldColours: readonly string[],
): ColourGalleries {
  const byColour = new Map<string, string[]>();
  for (const colour of soldColours) byColour.set(colour, []);

  const quarantined: string[] = [];

  for (const image of images) {
    const resolution = resolveImageColour(image.sourceFile, tokenMap, soldColours);
    if (resolution.kind === 'assigned') {
      const bucket = byColour.get(resolution.colour) ?? [];
      bucket.push(image.url);
      byColour.set(resolution.colour, bucket);
    } else {
      // Kept, not deleted — it goes to the review queue and keeps its bytes.
      quarantined.push(image.sourceFile);
    }
  }

  return { byColour, quarantined, hasQuarantine: quarantined.length > 0 };
}

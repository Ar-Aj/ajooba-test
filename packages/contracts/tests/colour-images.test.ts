/**
 * Colour → image resolution, exercised against the real catalogue data.
 *
 * These are the cases that actually broke in production, expressed as unit
 * tests so a future change to the resolver cannot silently reintroduce them.
 * Every fixture is copied verbatim from the live `products` collection.
 */

import { describe, expect, it } from 'vitest';
import {
  buildColourGalleries,
  buildColourTokenMap,
  extractColourToken,
  resolveImageColour,
} from '../src/catalog/colour-images.js';

describe('extractColourToken', () => {
  it('reads the token from a tokenised filename', () => {
    expect(extractColourToken('A46-BRN-2.png')).toBe('BRN');
    expect(extractColourToken('A48-GRY-1.png')).toBe('GRY');
  });

  it('normalises the mixed casing found in the source data', () => {
    // A18 and A46 both mix Tan and TAN in the same folder.
    expect(extractColourToken('A18-Tan-1.jpeg')).toBe('TAN');
    expect(extractColourToken('A46-Tan-7.jpeg')).toBe('TAN');
  });

  it('tolerates the un-zero-padded folder naming', () => {
    expect(extractColourToken('A6-Blk-1.jpg')).toBe('BLK');
  });

  it('returns null when the filename carries no token', () => {
    expect(extractColourToken('A1 - 1.jpg')).toBeNull();
    expect(extractColourToken('A10-7.jpg')).toBeNull();
    expect(extractColourToken('A10-7(1).jpg')).toBeNull();
  });
});

describe('buildColourTokenMap', () => {
  it('maps every token a design sells to its colour', () => {
    const map = buildColourTokenMap([
      { colour: 'Black', colourToken: 'BLK' },
      { colour: 'Brown', colourToken: 'BRN' },
      { colour: 'Tan', colourToken: 'TAN' },
    ]);
    expect(map.get('BLK')).toBe('Black');
    expect(map.get('BRN')).toBe('Brown');
    expect(map.get('TAN')).toBe('Tan');
  });

  it('maps all three Ivory spellings onto the same colour', () => {
    // The catalogue sells Ivory as OW, IVY and IVR. All are Ivory.
    const map = buildColourTokenMap([
      { colour: 'Ivory', colourToken: 'OW' },
      { colour: 'Ivory', colourToken: 'IVY' },
      { colour: 'Ivory', colourToken: 'IVR' },
    ]);
    expect(map.get('OW')).toBe('Ivory');
    expect(map.get('IVY')).toBe('Ivory');
    expect(map.get('IVR')).toBe('Ivory');
  });
});

describe('resolveImageColour', () => {
  const a46Map = buildColourTokenMap([
    { colour: 'Black', colourToken: 'BLK' },
    { colour: 'Brown', colourToken: 'BRN' },
    { colour: 'Tan', colourToken: 'TAN' },
  ]);

  it('assigns a tokenised image to the colour it was sold in', () => {
    const result = resolveImageColour('A46-BLK-1.jpeg', a46Map, ['Black', 'Brown', 'Tan']);
    expect(result).toMatchObject({ kind: 'assigned', colour: 'Black' });
  });

  it('accepts the mixed-case Tan filenames on A46', () => {
    const result = resolveImageColour('A46-Tan-7.jpeg', a46Map, ['Black', 'Brown', 'Tan']);
    expect(result).toMatchObject({ kind: 'assigned', colour: 'Tan' });
  });

  it('quarantines a token for a colour the design does not sell', () => {
    // A30 is sold Black/Brown but photographed as A30-TAN-*.
    const map = buildColourTokenMap([
      { colour: 'Black', colourToken: 'BLK' },
      { colour: 'Brown', colourToken: 'BRN' },
    ]);
    const result = resolveImageColour('A30-TAN-1.jpg', map, ['Black', 'Brown']);
    expect(result).toMatchObject({ kind: 'unverified', reason: 'token-not-sold', token: 'TAN' });
  });

  it('quarantines an untokened image on a multi-colour design', () => {
    const result = resolveImageColour('A44-3.png', a46Map, ['Black', 'Brown']);
    expect(result).toMatchObject({ kind: 'unverified', reason: 'untokened' });
  });

  it('keeps untokened images on a single-colour design', () => {
    // A01 sells only Ivory and its files are "A1 - 1.jpg" with no token.
    const map = buildColourTokenMap([{ colour: 'Ivory', colourToken: 'IVY' }]);
    const result = resolveImageColour('A1 - 1.jpg', map, ['Ivory']);
    expect(result).toMatchObject({ kind: 'assigned', colour: 'Ivory' });
  });

  it('assigns a tokenised image on a single-colour design', () => {
    const map = buildColourTokenMap([{ colour: 'Grey', colourToken: 'GRY' }]);
    const result = resolveImageColour('A48-GRY-3.png', map, ['Grey']);
    expect(result).toMatchObject({ kind: 'assigned', colour: 'Grey' });
  });
});

describe('buildColourGalleries', () => {
  it('splits A16 by colour and holds back the White photos it does not sell', () => {
    const map = buildColourTokenMap([
      { colour: 'Black', colourToken: 'BLK' },
      { colour: 'Brown', colourToken: 'BRN' },
      { colour: 'Tan', colourToken: 'TAN' },
    ]);
    const images = [
      { sourceFile: 'A16-BLK-1.jpg', url: '/p/A16-BLK-1.jpg' },
      { sourceFile: 'A16-BRN-1.jpg', url: '/p/A16-BRN-1.jpg' },
      { sourceFile: 'A16-TAN-1.jpg', url: '/p/A16-TAN-1.jpg' },
      { sourceFile: 'A16-WHT-1.jpg', url: '/p/A16-WHT-1.jpg' },
    ];

    const { byColour, quarantined, hasQuarantine } = buildColourGalleries(images, map, [
      'Black',
      'Brown',
      'Tan',
    ]);

    expect(byColour.get('Black')).toEqual(['/p/A16-BLK-1.jpg']);
    expect(byColour.get('Brown')).toEqual(['/p/A16-BRN-1.jpg']);
    expect(byColour.get('Tan')).toEqual(['/p/A16-TAN-1.jpg']);
    // White is not a colour this design sells, so it appears in no gallery.
    expect(quarantined).toEqual(['A16-WHT-1.jpg']);
    expect(hasQuarantine).toBe(true);
  });

  it('never leaks a quarantined image into any colour gallery', () => {
    const map = buildColourTokenMap([
      { colour: 'Black', colourToken: 'BLK' },
      { colour: 'Brown', colourToken: 'BRN' },
    ]);
    const images = [
      { sourceFile: 'A30-BLK-1.jpg', url: '/p/A30-BLK-1.jpg' },
      { sourceFile: 'A30-TAN-1.jpg', url: '/p/A30-TAN-1.jpg' },
      { sourceFile: 'A30-TAN-2.jpg', url: '/p/A30-TAN-2.jpg' },
    ];

    const { byColour, quarantined } = buildColourGalleries(images, map, ['Black', 'Brown']);

    expect(byColour.get('Black')).toEqual(['/p/A30-BLK-1.jpg']);
    expect(byColour.get('Brown')).toEqual([]);
    expect(quarantined).toHaveLength(2);
    // Brown must not silently receive the Tan photography.
    expect(byColour.get('Brown')).not.toContain('/p/A30-TAN-1.jpg');
  });

  it('gives a colour with no verified photos an empty gallery, not a borrowed one', () => {
    const map = buildColourTokenMap([
      { colour: 'Black', colourToken: 'BLK' },
      { colour: 'Brown', colourToken: 'BRN' },
      { colour: 'Tan', colourToken: 'TAN' },
      { colour: 'White', colourToken: 'WHT' },
    ]);
    const images = [
      { sourceFile: 'A14-BRN-1.jpg', url: '/p/A14-BRN-1.jpg' },
      { sourceFile: 'A14-WHT-1.jpg', url: '/p/A14-WHT-1.jpg' },
    ];

    const { byColour } = buildColourGalleries(images, map, ['Black', 'Brown', 'Tan', 'White']);

    // A14 declares Black and Tan but has no photography for either.
    expect(byColour.get('Black')).toEqual([]);
    expect(byColour.get('Tan')).toEqual([]);
    expect(byColour.get('Brown')).toEqual(['/p/A14-BRN-1.jpg']);
    expect(byColour.get('White')).toEqual(['/p/A14-WHT-1.jpg']);
  });

  it('keeps every image of a clean multi-colour design', () => {
    const map = buildColourTokenMap([
      { colour: 'Black', colourToken: 'BLK' },
      { colour: 'Chickoo', colourToken: 'CHK' },
      { colour: 'Ivory', colourToken: 'IVY' },
    ]);
    const images = [
      { sourceFile: 'A15-BLK-1.jpg', url: '/p/A15-BLK-1.jpg' },
      { sourceFile: 'A15-CHK-1.jpg', url: '/p/A15-CHK-1.jpg' },
      { sourceFile: 'A15-IVY-1.jpg', url: '/p/A15-IVY-1.jpg' },
    ];

    const { quarantined, hasQuarantine } = buildColourGalleries(images, map, [
      'Black',
      'Chickoo',
      'Ivory',
    ]);

    expect(quarantined).toEqual([]);
    expect(hasQuarantine).toBe(false);
  });
});

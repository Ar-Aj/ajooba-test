import type { Product } from '@ajooba/contracts';
import { colourwaysOf } from '@/lib/colour-swatch';

export interface ShowroomProduct {
  code: string;
  name: string;
  slug: string;
  colour: string;
  price: number;
  pair: string;
  detail: string;
}

// The cutouts come from the corresponding pair and side photos in public/products.
// The second position places the black beaded mojri between the brown and ivory pairs.
const edit = [
  { code: 'A14', name: 'Gold Embroidered Mojri', colour: 'Brown' }, // A14-BRN views 1 and 4
  { code: 'A15', name: 'Gold Beadwork Mojri', colour: 'Black' }, // A15-BLK views 1 and 4
  { code: 'A10', name: 'Ivory Embroidered Mojri', colour: 'Ivory' }, // A10 views 1 and 4
  { code: 'A23', name: 'Patent Lace-Up Derby', colour: 'Brown' }, // A23-BRN views 1 and 4
  { code: 'A28', name: 'Perforated Strap Sandal', colour: 'Brown' }, // A28-BRN views 1 and 4
  { code: 'A30', name: 'Multi-Strap Sandal', colour: 'Black' }, // A30-BLK views 1 and 4
  { code: 'A48', name: 'Marble-Textured Loafer', colour: 'Grey' }, // A48-GRY views 1 and 3
] as const;

export function selectShowroomProducts(products: readonly Product[]): ShowroomProduct[] {
  const byCode = new Map(products.map((product) => [product.code.toUpperCase(), product]));
  return edit.flatMap(({ code, name, colour }) => {
    const product = byCode.get(code);
    if (!product || !product.colours.includes(colour)) return [];
    const colourway = colourwaysOf(product).find((way) => way.colour === colour);
    const stem = '/showroom/' + code.toLowerCase();
    return [
      {
        code,
        name,
        slug: product.slug,
        colour,
        price: colourway?.sellingPrice ?? product.sellingPrice,
        pair: stem + '-pair.webp',
        detail: stem + '-detail.webp',
      },
    ];
  });
}

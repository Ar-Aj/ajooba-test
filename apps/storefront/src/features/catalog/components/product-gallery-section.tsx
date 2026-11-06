'use client';

import { useMemo, useState } from 'react';
import type { Product } from '@ajooba/contracts';
import { ProductGallery } from './product-gallery';
import { ProductBuyBox } from './product-buy-box';

/**
 * Binds the gallery to the selected colour.
 *
 * The gallery and the buy box sit side by side, but colour selection lives in
 * the buy box while the image list is a prop-drilled server value. Left alone,
 * the gallery shows every image of the design no matter which colour is
 * selected — you pick Black and a brown shoe is in the second thumbnail.
 *
 * This component owns the colour selection and hands the same selection to both
 * halves, so the gallery, the sizes, the SKU, the price and the cart line all
 * describe one colour at any moment.
 *
 * Nothing here re-implements the colour rules: `Product.images` already carry a
 * verified `colour` field written by the import, and quarantined images (those
 * without one) are simply absent from it.
 */
export function ProductGallerySection({ product }: { product: Product }) {
  const [colour, setColour] = useState<string>(product.colours[0] ?? '');

  /*
   * Images for the selected colour only. An image appears here only if the
   * import verified its colour, so a quarantined image can never reach the
   * gallery by falling through to a default.
   *
   * When a colour has no verified photography this is deliberately EMPTY. We do
   * not fall back to another colour's photos: that is the exact defect being
   * fixed. `ProductGallery` renders an honest "no photo yet" field instead.
   */
  const images = useMemo(
    () => product.images.filter((image) => image.colour === colour),
    [product.images, colour],
  );

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-14">
      <div className="lg:col-span-7">
        <ProductGallery
          images={images}
          title={product.title}
          colour={colour}
          isPrimaryColour={colour === product.colours[0]}
        />
      </div>
      <div className="lg:col-span-5">
        <ProductBuyBox product={product} selectedColour={colour} onColourChange={setColour} />
      </div>
    </div>
  );
}

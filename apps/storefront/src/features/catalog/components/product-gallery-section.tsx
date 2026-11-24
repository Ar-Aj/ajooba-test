'use client';

import { useMemo, useState } from 'react';
import {
  buildColourTokenMap,
  resolveImageColour,
  type Product,
  type ProductImage,
} from '@ajooba/contracts';
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
 */
export function ProductGallerySection({ product }: { product: Product }) {
  /*
   * Ensure every image has its verified colour resolved (both from the stored
   * `image.colour` field and, if unmigrated, via `resolveImageColour` against
   * the design's variants).
   */
  const resolvedProduct = useMemo<Product>(() => {
    const needsResolution = product.images.some((image) => !image.colour);
    if (!needsResolution) return product;

    const soldColours =
      product.variants.length > 0
        ? [...new Set(product.variants.map((v) => v.colour))]
        : product.colours;
    const tokenMap = buildColourTokenMap(product.variants);

    const resolvedImages: ProductImage[] = product.images.map((img) => {
      if (img.colour) return img;
      const res = resolveImageColour(img.sourceFile, tokenMap, soldColours);
      if (res.kind === 'assigned') {
        return {
          ...img,
          colour: res.colour as ProductImage['colour'],
          ...(res.token ? { colourToken: res.token } : {}),
        };
      }
      return img;
    });

    return { ...product, images: resolvedImages };
  }, [product]);

  const initialColour = useMemo(() => {
    const firstWithImage = resolvedProduct.colours.find((c) =>
      resolvedProduct.images.some((img) => img.colour === c),
    );
    return firstWithImage ?? resolvedProduct.colours[0] ?? '';
  }, [resolvedProduct]);

  const [colour, setColour] = useState<string>(initialColour);

  /*
   * Images for the selected colour only. An image appears here only if its
   * colour is verified, so a quarantined image can never reach the gallery.
   */
  const images = useMemo(
    () => resolvedProduct.images.filter((image) => image.colour === colour),
    [resolvedProduct.images, colour],
  );

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-12 lg:gap-14">
      <div className="lg:col-span-7">
        <ProductGallery
          images={images}
          title={resolvedProduct.title}
          colour={colour}
          isPrimaryColour={colour === resolvedProduct.colours[0]}
        />
      </div>
      <div className="lg:col-span-5">
        <ProductBuyBox
          product={resolvedProduct}
          selectedColour={colour}
          onColourChange={setColour}
        />
      </div>
    </div>
  );
}

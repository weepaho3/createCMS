'use client';

import * as React from 'react';

import type { AssetImageOptions, ImageAsset } from './image';

import { useMediaMessages } from './context';
import { getAssetImage } from './image';

/** `getAssetImage` memoized, with provenance labels from the messages catalog. */
export function useAssetImage(
  asset: ImageAsset,
  options: AssetImageOptions,
): ReturnType<typeof getAssetImage> {
  const { messages } = useMediaMessages();
  const { sizes, widths, formats, focal, placeholderDataUrl } = options;
  const labels = options.provenanceLabels ?? messages.image.provenance;
  return React.useMemo(
    () =>
      getAssetImage(asset, {
        sizes,
        widths,
        formats,
        focal,
        placeholderDataUrl,
        provenanceLabels: labels,
      }),
    [asset, sizes, widths, formats, focal, placeholderDataUrl, labels],
  );
}

export type MediaImageProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'srcSet' | 'sizes' | 'width' | 'height'
> &
  Pick<AssetImageOptions, 'widths' | 'focal' | 'placeholderDataUrl'> & {
    asset: ImageAsset;
    sizes: string;
    /** Required: describe the image, or pass `""` for a decorative one. */
    alt: string;
  };

function useImageProps(
  props: MediaImageProps,
  formats: ('jxl' | 'avif' | 'webp')[] | undefined,
) {
  const {
    asset,
    sizes,
    widths,
    focal,
    placeholderDataUrl,
    style,
    onLoad,
    loading = 'lazy',
    decoding = 'async',
    ...rest
  } = props;
  const image = useAssetImage(asset, {
    sizes,
    widths,
    formats,
    focal,
    placeholderDataUrl,
  });
  const [loaded, setLoaded] = React.useState(false);
  const placeholder = image.placeholder.dataUrl
    ? `url(${image.placeholder.dataUrl}) center / cover no-repeat`
    : (image.placeholder.color ?? undefined);
  const img: React.ImgHTMLAttributes<HTMLImageElement> &
    Record<`data-${string}`, string | undefined> = {
    ...rest,
    src: image.src,
    srcSet: image.srcSet || undefined,
    sizes: image.srcSet ? image.sizes : undefined,
    width: image.width ?? undefined,
    height: image.height ?? undefined,
    loading,
    decoding,
    style: {
      objectPosition: image.objectPosition,
      ...(loaded || !placeholder ? null : { background: placeholder }),
      ...style,
    },
    onLoad: (event) => {
      setLoaded(true);
      onLoad?.(event);
    },
    'data-loaded': loaded ? '' : undefined,
    'data-placeholder': !loaded && placeholder ? '' : undefined,
    'data-variant-missing': image.missing.length
      ? image.missing.join(' ')
      : undefined,
    'data-provenance': image.provenance,
  };
  return { image, img };
}

/**
 * An `<img>` with a `srcset` of the asset's existing WebP renditions, the
 * placeholder as background until it loads, the focal point as
 * `object-position`, and `data-provenance`, `data-loaded`,
 * `data-placeholder` and `data-variant-missing`.
 */
export function MediaImage(props: MediaImageProps) {
  const { img } = useImageProps(props, ['webp']);
  // oxlint-disable-next-line jsx-a11y/alt-text -- `alt` is a required prop spread in `img`
  return <img {...img} />;
}

/**
 * A `<picture>` with one `<source>` per format that has renditions (JPEG
 * XL, then AVIF, then WebP) around the same `<img>` as `Media.Image`.
 */
export function MediaPicture(
  props: MediaImageProps & { formats?: ('jxl' | 'avif' | 'webp')[] },
) {
  const { formats, ...rest } = props;
  const { image, img } = useImageProps(rest, formats);
  return (
    <picture data-provenance={image.provenance}>
      {image.sources.map((source) => (
        <source
          key={source.type}
          type={source.type}
          srcSet={source.srcSet}
          sizes={image.sizes}
        />
      ))}
      {/* oxlint-disable-next-line jsx-a11y/alt-text -- `alt` is a required prop spread in `img` */}
      <img {...img} />
    </picture>
  );
}

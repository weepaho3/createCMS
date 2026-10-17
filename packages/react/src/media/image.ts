// @createcms/react/media/image: pure helpers for rendering assets as
// responsive images. No React, no client boundary: callable in server
// components. They read renditions from the asset's `variants` and never
// guess a width that does not exist.
import type { CmsAssetListItem } from '../editor/cms/types';

export type AssetProvenance = NonNullable<CmsAssetListItem['provenance']>;

/** The asset fields the image helpers read. */
export type ImageAsset = Pick<
  CmsAssetListItem,
  'id' | 'deliveryUrl' | 'mimeType'
> &
  Partial<
    Pick<
      CmsAssetListItem,
      'width' | 'height' | 'variants' | 'metadata' | 'provenance'
    >
  >;

export type ImageFormat = 'avif' | 'webp' | 'jpeg';

type Rendition = { width: number; height: number | null; format: ImageFormat };

const IMAGE_KEY =
  /^w([1-9][0-9]*)(?:-h([1-9][0-9]*))?(?:-q[0-9]+)?(?:-fit(?:cover|contain))?\.(avif|webp|jpeg)$/;

/** The width renditions of `asset` (posters and cropped keys excluded). */
function renditionsOf(asset: ImageAsset): Rendition[] {
  const out: Rendition[] = [];
  for (const variant of asset.variants ?? []) {
    const match = IMAGE_KEY.exec(variant.variantKey);
    if (!match || match[2]) continue;
    out.push({
      width: Number(match[1]),
      height: variant.height,
      format: match[3] as ImageFormat,
    });
  }
  return out.sort((a, b) => a.width - b.width);
}

function withQuery(url: string, query: Record<string, string | number>) {
  const params = new URLSearchParams(
    Object.entries(query).map(([k, v]) => [k, String(v)]),
  );
  return `${url}${url.includes('?') ? '&' : '?'}${params}`;
}

/**
 * The URL of the smallest existing rendition of `asset` in `format` that is
 * at least `w` wide (the widest one when none is), or `null` when the asset
 * has no rendition in that format. Never returns a width that does not exist.
 */
export function variantUrl(
  asset: ImageAsset,
  options: { w: number; format?: ImageFormat },
): string | null {
  const format = options.format ?? 'webp';
  const candidates = renditionsOf(asset).filter((r) => r.format === format);
  if (candidates.length === 0) return null;
  const pick =
    candidates.find((r) => r.width >= options.w) ?? candidates.at(-1)!;
  return withQuery(asset.deliveryUrl, { w: pick.width, format });
}

/** A `srcset` of every existing rendition of `asset` in `format`. */
export function buildSrcSet(asset: ImageAsset, format: ImageFormat): string {
  return renditionsOf(asset)
    .filter((r) => r.format === format)
    .map(
      (r) =>
        `${withQuery(asset.deliveryUrl, { w: r.width, format })} ${r.width}w`,
    )
    .join(', ');
}

/** CSS `object-position` for a focal point given as fractions (default centre). */
export function objectPositionOf(
  focal: { x: number; y: number } | null | undefined,
): string {
  if (!focal) return '50% 50%';
  const pct = (v: number) =>
    `${Math.round(Math.min(1, Math.max(0, v)) * 10_000) / 100}%`;
  return `${pct(focal.x)} ${pct(focal.y)}`;
}

export type AssetImageOptions = {
  /** The `sizes` attribute for the `srcset`. */
  sizes: string;
  /** Rendition widths the app expects; used to report `missing`. */
  widths?: number[];
  /** Formats offered as `<source>`s, in order of preference. @default ['avif', 'webp'] */
  formats?: ('avif' | 'webp')[];
  /** Overrides the asset's focal point, e.g. `AssetRef.focal`. */
  focal?: { x: number; y: number };
  /** Decodes a ThumbHash to a data URL (`placeholderDataUrl` from `@createcms/core`). */
  placeholderDataUrl?: (thumbhash: string) => string;
  /** Labels for AI provenance; `provenanceLabel` is `null` without one. */
  provenanceLabels?: Partial<Record<AssetProvenance, string>>;
};

export type AssetImage = {
  src: string;
  srcSet: string;
  sizes: string;
  width: number | null;
  height: number | null;
  /** One per format with renditions, for `<picture>`. */
  sources: { type: string; srcSet: string }[];
  placeholder: { color: string | null; dataUrl: string | null };
  objectPosition: string;
  provenance: AssetProvenance;
  provenanceLabel: string | null;
  /** Expected variant keys (`widths` below the source width x formats) that do not exist. */
  missing: string[];
};

function metadataOf(asset: ImageAsset) {
  return (asset.metadata ?? {}) as {
    focal?: { x: number; y: number };
    placeholder?: { thumbhash?: string };
    dominantColor?: string;
  };
}

/**
 * Everything to render `asset` as a responsive image: `srcset`s from its
 * existing renditions only, the placeholder, the focal point as
 * `object-position` and its provenance. `src` is the 1280 px WebP rendition
 * (or the nearest one), else the original through the asset endpoint.
 */
export function getAssetImage(
  asset: ImageAsset,
  options: AssetImageOptions,
): AssetImage {
  const metadata = metadataOf(asset);
  const formats = options.formats ?? ['avif', 'webp'];
  const sources = formats
    .map((format) => ({
      type: `image/${format}`,
      srcSet: buildSrcSet(asset, format),
    }))
    .filter((source) => source.srcSet !== '');
  const webp = buildSrcSet(asset, 'webp');

  const present = new Set((asset.variants ?? []).map((v) => v.variantKey));
  const sourceWidth = asset.width ?? Number.POSITIVE_INFINITY;
  const missing: string[] = [];
  for (const w of options.widths ?? []) {
    if (w >= sourceWidth * 0.9) continue;
    for (const format of formats) {
      const key = `w${w}.${format}`;
      if (!present.has(key)) missing.push(key);
    }
  }

  const thumbhash = metadata.placeholder?.thumbhash;
  const provenance = asset.provenance ?? 'unknown';
  return {
    src: variantUrl(asset, { w: 1280, format: 'webp' }) ?? asset.deliveryUrl,
    srcSet: webp,
    sizes: options.sizes,
    width: asset.width ?? null,
    height: asset.height ?? null,
    sources,
    placeholder: {
      color: metadata.dominantColor ?? null,
      dataUrl:
        thumbhash && options.placeholderDataUrl
          ? options.placeholderDataUrl(thumbhash)
          : null,
    },
    objectPosition: objectPositionOf(options.focal ?? metadata.focal),
    provenance,
    provenanceLabel: options.provenanceLabels?.[provenance] ?? null,
    missing,
  };
}

/** Default rendition widths, as the media-optimize plugin produces them. */
export const RENDITION_WIDTHS = [320, 640, 1280, 1920] as const;

/**
 * An image loader for frameworks that ask for arbitrary widths (Next.js
 * `loaderFile`): the width snaps up to the next of `widths` (the largest
 * when above), and the URL asks the asset endpoint for that rendition, so
 * no request names a width outside the ladder.
 */
export function createImageLoader(
  options: { widths?: readonly number[]; format?: ImageFormat } = {},
) {
  const widths = [...(options.widths ?? RENDITION_WIDTHS)].sort(
    (a, b) => a - b,
  );
  const format = options.format ?? 'webp';
  return ({ src, width }: { src: string; width: number; quality?: number }) => {
    const snapped = widths.find((w) => w >= width) ?? widths.at(-1)!;
    return withQuery(src, { w: snapped, format });
  };
}

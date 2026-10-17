/**
 * The canonical identity of a variant, shared by the optimizer, the server's
 * validation, the gate and `srcset` builders. No DOM or Node APIs.
 *
 * Grammar:
 *   image:  `w{width}[-h{height}][-q{quality}][-fit{cover|contain}].{format}`
 *   poster: `poster-w{width}.{format}`
 * Numbers have no leading zeros; width and height are 1 to 16384, quality
 * 1 to 100; `format` is one of `webp`, `avif`, `jpeg`, `png`.
 */

export const VARIANT_FORMATS = ['webp', 'avif', 'jpeg', 'png'] as const;
export type VariantFormat = (typeof VARIANT_FORMATS)[number];

export type VariantSpec = {
  kind: 'image' | 'poster';
  width: number;
  height?: number;
  quality?: number;
  fit?: 'cover' | 'contain';
  format: VariantFormat;
};

const MAX_DIMENSION = 16_384;
const NUMBER = '([1-9][0-9]*)';
const FORMAT = `(${VARIANT_FORMATS.join('|')})`;
const IMAGE_KEY = new RegExp(
  `^w${NUMBER}(?:-h${NUMBER})?(?:-q${NUMBER})?(?:-fit(cover|contain))?\\.${FORMAT}$`,
);
const POSTER_KEY = new RegExp(`^poster-w${NUMBER}\\.${FORMAT}$`);

function inRange(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= max;
}

function isValid(spec: VariantSpec): boolean {
  if (!inRange(spec.width, MAX_DIMENSION)) return false;
  if (!VARIANT_FORMATS.includes(spec.format)) return false;
  if (spec.kind === 'poster') {
    return (
      spec.height === undefined &&
      spec.quality === undefined &&
      spec.fit === undefined
    );
  }
  if (spec.height !== undefined && !inRange(spec.height, MAX_DIMENSION)) {
    return false;
  }
  if (spec.quality !== undefined && !inRange(spec.quality, 100)) return false;
  return (
    spec.fit === undefined || spec.fit === 'cover' || spec.fit === 'contain'
  );
}

/** Parses a variant key; `null` for anything outside the grammar. */
export function parseVariantKey(key: string): VariantSpec | null {
  const poster = POSTER_KEY.exec(key);
  if (poster) {
    const spec: VariantSpec = {
      kind: 'poster',
      width: Number(poster[1]),
      format: poster[2] as VariantFormat,
    };
    return isValid(spec) ? spec : null;
  }
  const image = IMAGE_KEY.exec(key);
  if (!image) return null;
  const spec: VariantSpec = {
    kind: 'image',
    width: Number(image[1]),
    format: image[5] as VariantFormat,
  };
  if (image[2]) spec.height = Number(image[2]);
  if (image[3]) spec.quality = Number(image[3]);
  if (image[4]) spec.fit = image[4] as 'cover' | 'contain';
  return isValid(spec) ? spec : null;
}

/** The canonical key for `spec`; throws for a spec outside the grammar. */
export function formatVariantKey(spec: VariantSpec): string {
  if (!isValid(spec)) {
    throw new Error(`Invalid variant spec: ${JSON.stringify(spec)}`);
  }
  if (spec.kind === 'poster') return `poster-w${spec.width}.${spec.format}`;
  let key = `w${spec.width}`;
  if (spec.height !== undefined) key += `-h${spec.height}`;
  if (spec.quality !== undefined) key += `-q${spec.quality}`;
  if (spec.fit !== undefined) key += `-fit${spec.fit}`;
  return `${key}.${spec.format}`;
}

const LEGACY_FORMATS: Readonly<Record<string, VariantFormat>> = {
  webp: 'webp',
  avif: 'avif',
  jpeg: 'jpeg',
  jpg: 'jpeg',
  png: 'png',
};

/**
 * The variant spec of a slug built by the former slug scheme:
 * `<base>-<width>-<format>.<format>`, or `<base>-<width>.<ext>` with the
 * original extension, each optionally with a collision counter (`-2`)
 * before the extension. `baseSlug` is the original asset's slug. `null` when
 * the slug does not follow the scheme or carries no width (format-only
 * variants have no canonical key).
 */
export function parseLegacyVariantSlug(
  slug: string,
  baseSlug: string,
): VariantSpec | null {
  const dot = baseSlug.lastIndexOf('.');
  const base = dot > 0 ? baseSlug.slice(0, dot) : baseSlug;
  if (!slug.startsWith(`${base}-`)) return null;
  const rest = slug.slice(base.length + 1);

  const withFormat = /^([1-9][0-9]*)-([a-z]+)(?:-[0-9]+)?\.([a-z]+)$/.exec(
    rest,
  );
  const widthOnly = /^([1-9][0-9]*)(?:-[0-9]+)?\.([a-z]+)$/.exec(rest);
  let width: string;
  let format: VariantFormat | undefined;
  if (withFormat) {
    const [, w, name, extension] = withFormat;
    if (LEGACY_FORMATS[extension] !== LEGACY_FORMATS[name]) return null;
    width = w;
    format = LEGACY_FORMATS[name];
  } else if (widthOnly) {
    width = widthOnly[1];
    format = LEGACY_FORMATS[widthOnly[2]];
  } else {
    return null;
  }
  if (!format) return null;
  const spec: VariantSpec = { kind: 'image', width: Number(width), format };
  return isValid(spec) ? spec : null;
}

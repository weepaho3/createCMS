/** Output formats a transform service can be asked for. */
export type TransformFormat = 'webp' | 'avif' | 'jxl' | 'jpeg' | 'png';

/** The original a transform reads: always a public object. */
export type TransformSource = {
  assetId: string;
  /** Public URL of the original object. */
  url: string;
  objectKey: string;
  width: number | null;
  height: number | null;
  /** Focal point as fractions of the width and height (0 to 1). */
  focalPoint?: { x: number; y: number };
};

export type TransformSpec = {
  w: number;
  h?: number;
  /** `cover` crops around the focal point; `contain` keeps the whole image. */
  fit?: 'cover' | 'contain';
  format: TransformFormat;
  q: number;
};

/**
 * An image transform service the asset endpoint redirects to when an asset
 * has no stored rendition for `?w` and `?format`. Only allowlisted widths,
 * formats and qualities reach it, the format is part of the URL (no
 * `Vary: Accept`), and `url` must return a URL the service verifies (a
 * signature), so nobody can request other sizes from it directly.
 */
export type TransformAdapter = {
  id: string;
  formats: readonly TransformFormat[];
  widths: readonly number[];
  qualities: readonly number[];
  /** Throws `TransformNotAllowedError` for a spec outside the allowlists. */
  url(source: TransformSource, spec: TransformSpec): Promise<string>;
};

export class TransformNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransformNotAllowedError';
  }
}

/** Widths of transformed renditions when an adapter names none. */
export const TRANSFORM_WIDTHS = [320, 640, 960, 1280, 1920, 2560] as const;

/** Rejects a spec the adapter does not allow. */
export function assertTransformAllowed(
  adapter: Pick<TransformAdapter, 'formats' | 'widths' | 'qualities'>,
  spec: TransformSpec,
): void {
  if (!adapter.widths.includes(spec.w)) {
    throw new TransformNotAllowedError(`Width ${spec.w} is not allowed`);
  }
  if (spec.h !== undefined && !adapter.widths.includes(spec.h)) {
    throw new TransformNotAllowedError(`Height ${spec.h} is not allowed`);
  }
  if (!adapter.formats.includes(spec.format)) {
    throw new TransformNotAllowedError(`Format ${spec.format} is not allowed`);
  }
  if (!adapter.qualities.includes(spec.q)) {
    throw new TransformNotAllowedError(`Quality ${spec.q} is not allowed`);
  }
}

const encoder = new TextEncoder();

function hexBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) {
    throw new Error('imgproxy key and salt must be hex encoded');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

/**
 * The imgproxy signature of `path` (everything after the signature segment,
 * with its leading `/`): URL-safe Base64 of HMAC-SHA256(key, salt + path).
 */
export async function imgproxySignature(
  keyHex: string,
  saltHex: string,
  path: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    hexBytes(keyHex) as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const salt = hexBytes(saltHex);
  const message = new Uint8Array(salt.length + encoder.encode(path).length);
  message.set(salt);
  message.set(encoder.encode(path), salt.length);
  return base64Url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, message)),
  );
}

export type ImgproxyTransformOptions = {
  /** Base URL of the imgproxy service, e.g. `https://img.example.com`. */
  baseUrl: string;
  /** `IMGPROXY_KEY`, hex encoded. */
  key: string;
  /** `IMGPROXY_SALT`, hex encoded. */
  salt: string;
  /** @default TRANSFORM_WIDTHS */
  widths?: readonly number[];
  /** @default ['webp', 'avif', 'jpeg', 'png'] */
  formats?: readonly TransformFormat[];
  /** @default [75] */
  qualities?: readonly number[];
};

/**
 * A `TransformAdapter` for imgproxy with signed URLs. Run imgproxy with
 * `IMGPROXY_KEY` and `IMGPROXY_SALT` set to the same pair, so it refuses
 * unsigned URLs, and without enlarging. Widths resize with `rs:fit`; with a
 * height and `fit: 'cover'` the crop is centered on the focal point.
 */
export function imgproxyTransform(
  options: ImgproxyTransformOptions,
): TransformAdapter {
  hexBytes(options.key);
  hexBytes(options.salt);
  const base = options.baseUrl.replace(/\/+$/, '');
  const adapter: TransformAdapter = {
    id: 'imgproxy',
    formats: options.formats ?? ['webp', 'avif', 'jpeg', 'png'],
    widths: options.widths ?? TRANSFORM_WIDTHS,
    qualities: options.qualities ?? [75],
    async url(source, spec) {
      assertTransformAllowed(adapter, spec);
      const segments = [
        `rs:${spec.h !== undefined && spec.fit !== 'contain' ? 'fill' : 'fit'}:${spec.w}:${spec.h ?? 0}:0`,
      ];
      if (spec.h !== undefined && spec.fit !== 'contain' && source.focalPoint) {
        segments.push(`g:fp:${source.focalPoint.x}:${source.focalPoint.y}`);
      }
      segments.push(`q:${spec.q}`);
      const encoded = base64Url(encoder.encode(source.url));
      const path = `/${segments.join('/')}/${encoded}.${spec.format}`;
      const signature = await imgproxySignature(
        options.key,
        options.salt,
        path,
      );
      return `${base}/${signature}${path}`;
    },
  };
  return adapter;
}

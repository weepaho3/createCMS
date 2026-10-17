import type { DecodedImage, PipelineEnv } from './process';

/**
 * A WASM encoder module in the shape jSquash exports: `default` encodes RGBA
 * pixels, `init` loads the WASM binary ahead of the first encode.
 */
export type EncoderModule = {
  default: (
    data: ImageData,
    options: Record<string, number>,
  ) => Promise<ArrayBuffer>;
  init?: () => Promise<unknown>;
};

/** A HEIC decoder (for example libheif-js wrapped by the host). */
export type HeicDecoderModule = {
  decode: (bytes: ArrayBuffer) => Promise<ImageData>;
  init?: () => Promise<unknown>;
};

/**
 * Lazy loaders for the WASM codecs. Each is called the first time its
 * codec is needed, never at startup, so a browser only downloads what it
 * uses. Write the imports in app (or worker) code so the bundler emits the
 * WASM files:
 *
 * ```ts
 * codecs: {
 *   webp: () => import('@jsquash/webp/encode'),
 *   jpeg: () => import('@jsquash/jpeg/encode'),
 *   avif: () => import('@jsquash/avif/encode'),
 * }
 * ```
 */
export type CodecLoaders = {
  /** WebP for browsers whose canvas cannot encode WebP (Safari). */
  webp?: () => Promise<EncoderModule>;
  /** mozjpeg; without it JPEG falls back to the canvas encoder. */
  jpeg?: () => Promise<EncoderModule>;
  /** AVIF; renditions in AVIF are produced only with this loader. */
  avif?: () => Promise<EncoderModule>;
  /** HEIC decoding where `createImageBitmap` cannot (all but Safari). */
  heic?: () => Promise<HeicDecoderModule>;
};

type Canvas = {
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  toBlob: (type: string, quality?: number) => Promise<Blob>;
  release: () => void;
};

function createCanvas(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2d context');
    return {
      context,
      toBlob: (type, quality) => canvas.convertToBlob({ type, quality }),
      release: () => {
        canvas.width = 0;
        canvas.height = 0;
      },
    };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No 2d context');
  return {
    context,
    toBlob: (type, quality) =>
      new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error(`Canvas could not encode ${type}`));
            }
          },
          type,
          quality,
        );
      }),
    release: () => {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

type BitmapImage = DecodedImage & { bitmap: ImageBitmap };

const loaded = new WeakMap<() => Promise<unknown>, Promise<unknown>>();

/** Loads (once per loader) and initializes a codec module. */
function load<T extends { init?: () => Promise<unknown> }>(
  loader: () => Promise<T>,
): Promise<T> {
  let pending = loaded.get(loader) as Promise<T> | undefined;
  if (!pending) {
    pending = (async () => {
      const mod = await loader();
      await mod.init?.();
      return mod;
    })();
    loaded.set(loader, pending);
    pending.catch(() => loaded.delete(loader));
  }
  return pending;
}

let nativeWebp: Promise<boolean> | undefined;

/** Whether this context's canvas encodes WebP (checked once). */
export function canEncodeWebpNatively(): Promise<boolean> {
  nativeWebp ??= (async () => {
    try {
      const canvas = createCanvas(1, 1);
      const blob = await canvas.toBlob('image/webp');
      canvas.release();
      return blob.type === 'image/webp';
    } catch {
      return false;
    }
  })();
  return nativeWebp;
}

/** The pipeline environment of a browser tab or worker. */
export function createBrowserEnv(
  codecs: CodecLoaders = {},
  options: { avifSpeed?: number } = {},
): PipelineEnv {
  async function scaled(
    image: DecodedImage,
    width: number,
    height: number,
  ): Promise<Canvas> {
    const source = (image as BitmapImage).bitmap;
    const resized =
      width === image.width && height === image.height
        ? source
        : await createImageBitmap(source, {
            resizeWidth: width,
            resizeHeight: height,
            resizeQuality: 'high',
          });
    const canvas = createCanvas(width, height);
    canvas.context.drawImage(resized, 0, 0, width, height);
    if (resized !== source) resized.close();
    return canvas;
  }

  async function encodeWith(
    loader: () => Promise<EncoderModule>,
    canvas: Canvas,
    width: number,
    height: number,
    type: string,
    settings: Record<string, number>,
  ): Promise<Blob> {
    const mod = await load(loader);
    const pixels = canvas.context.getImageData(0, 0, width, height);
    return new Blob([await mod.default(pixels, settings)], { type });
  }

  return {
    async decode(blob, type) {
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(blob, {
          imageOrientation: 'from-image',
        });
      } catch (err) {
        if (type !== 'image/heic' || !codecs.heic) throw err;
        const heic = await load(codecs.heic);
        bitmap = await createImageBitmap(
          await heic.decode(await blob.arrayBuffer()),
        );
      }
      return {
        width: bitmap.width,
        height: bitmap.height,
        bitmap,
        close: () => bitmap.close(),
      } satisfies BitmapImage;
    },

    async encode(image, { width, height, format, quality }) {
      const canvas = await scaled(image, width, height);
      try {
        const type = `image/${format}`;
        if (format === 'webp') {
          if (await canEncodeWebpNatively()) {
            return await canvas.toBlob(type, quality / 100);
          }
          if (!codecs.webp) {
            throw new Error(
              'This browser cannot encode WebP and no `codecs.webp` loader is set',
            );
          }
          return await encodeWith(codecs.webp, canvas, width, height, type, {
            quality,
          });
        }
        if (format === 'jpeg') {
          if (codecs.jpeg) {
            return await encodeWith(codecs.jpeg, canvas, width, height, type, {
              quality,
            });
          }
          return await canvas.toBlob(type, quality / 100);
        }
        if (format === 'avif') {
          if (!codecs.avif)
            throw new Error('AVIF needs the `codecs.avif` loader');
          return await encodeWith(codecs.avif, canvas, width, height, type, {
            quality,
            speed: options.avifSpeed ?? 8,
          });
        }
        return await canvas.toBlob(type);
      } finally {
        canvas.release();
      }
    },

    async pixels(image, maxEdge) {
      const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = await scaled(image, width, height);
      try {
        const { data } = canvas.context.getImageData(0, 0, width, height);
        return { data, width, height };
      } finally {
        canvas.release();
      }
    },
  };
}

/** Which optimization steps this browser can run with `codecs`. */
export type OptimizeSupport = {
  worker: boolean;
  webp: 'native' | 'wasm' | false;
  jpeg: 'mozjpeg' | 'canvas';
  avif: boolean;
  heic: 'native' | 'wasm' | false;
};

/** Detects the optimization support of this browser. */
export async function detectOptimizeSupport(
  codecs: CodecLoaders = {},
): Promise<OptimizeSupport> {
  const native = await canEncodeWebpNatively();
  // Safari is the only engine that decodes HEIC natively.
  const heicNative =
    typeof navigator !== 'undefined' &&
    /Safari/.test(navigator.userAgent) &&
    !/Chrome|Chromium|Firefox|Edg/.test(navigator.userAgent);
  let heic: OptimizeSupport['heic'] = false;
  if (heicNative) heic = 'native';
  else if (codecs.heic) heic = 'wasm';
  let webp: OptimizeSupport['webp'] = false;
  if (native) webp = 'native';
  else if (codecs.webp) webp = 'wasm';
  return {
    worker: typeof Worker !== 'undefined',
    webp,
    jpeg: codecs.jpeg ? 'mozjpeg' : 'canvas',
    avif: Boolean(codecs.avif),
    heic,
  };
}

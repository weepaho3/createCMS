import type {
  OptimizationConfig,
  WebpEncoderModule,
} from '../../core/types/s3';

import {
  ANIMATION_SCAN_BYTES,
  ENCODABLE_TYPES,
  hasProvenanceMarker,
  isAnimated,
  outputName,
  PROVENANCE_SCAN_BYTES,
} from './sniff';

/**
 * Why a file was uploaded as-is:
 * - `optimize_unsupported`: the format or the browser cannot be re-encoded
 *   (SVG, GIF, HEIC, animated WebP/APNG, WebP without an encoder).
 * - `optimize_skipped_provenance`: the file carries IPTC `DigitalSourceType`
 *   or a C2PA manifest, which a re-encode would drop.
 * - `optimize_mislabel`: the encoder returned another type than requested.
 * - `optimize_failed`: decoding, the fallback encoder or encoding threw.
 */
export type OptimizeWarningCode =
  | 'optimize_unsupported'
  | 'optimize_skipped_provenance'
  | 'optimize_mislabel'
  | 'optimize_failed';

export type OptimizeWarning = {
  code: OptimizeWarningCode;
  /** The input file the warning is about. */
  file: File;
  message: string;
};

export type OptimizeResult = {
  /** The file to upload: the optimized output or the untouched input. */
  file: File;
  /** Resized copy in the input format, when `convert.storeOriginal` is set. */
  originalVariant?: File;
  optimized: boolean;
  bytesBefore: number;
  bytesAfter: number;
  warning?: OptimizeWarning;
};

/** A decoded image, already scaled to its output size. */
export type Raster = {
  width: number;
  height: number;
  /** True when the output size is smaller than the decoded size. */
  resized: boolean;
  toBlob: (type: string, quality: number) => Promise<Blob>;
  imageData: () => ImageData;
};

/** Browser primitives behind the pipeline, swapped out in tests. */
export type OptimizeDeps = {
  rasterize: (file: File, maxSize: number | undefined) => Promise<Raster>;
  supportsNativeWebp: () => Promise<boolean>;
};

const DEFAULT_QUALITY = 82;
const DEFAULT_KEEP_IF_SMALLER_RATIO = 0.9;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.addEventListener('load', () => {
      URL.revokeObjectURL(url);
      resolve(img);
    });
    img.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to decode image: ${file.name}`));
    });
    img.src = url;
  });
}

function fitWithin(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  if (width <= maxSize && height <= maxSize) return { width, height };
  const ratio = width / height;
  if (width > height) {
    return { width: maxSize, height: Math.round(maxSize / ratio) };
  }
  return { width: Math.round(maxSize * ratio), height: maxSize };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        // if/else (not a ternary) so the linter sees the two resolution calls
        // as mutually exclusive (promise/no-multiple-resolved).
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error(`canvas.toBlob failed for ${type}`));
        }
      },
      type,
      quality,
    );
  });
}

async function rasterize(
  file: File,
  maxSize: number | undefined,
): Promise<Raster> {
  const img = await loadImage(file);
  const natural = { width: img.naturalWidth, height: img.naturalHeight };
  const { width, height } =
    maxSize == null
      ? natural
      : fitWithin(natural.width, natural.height, maxSize);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas 2d context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  return {
    width,
    height,
    resized: width < natural.width || height < natural.height,
    toBlob: (type, quality) => canvasToBlob(canvas, type, quality),
    imageData: () => ctx.getImageData(0, 0, width, height),
  };
}

let nativeWebp: Promise<boolean> | null = null;

function supportsNativeWebp(): Promise<boolean> {
  nativeWebp ??= new Promise<boolean>((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    canvas.toBlob((blob) => resolve(blob?.type === 'image/webp'), 'image/webp');
  });
  return nativeWebp;
}

const browserDeps: OptimizeDeps = { rasterize, supportsNativeWebp };

const encoderModules = new WeakMap<
  () => Promise<WebpEncoderModule>,
  Promise<WebpEncoderModule>
>();

class EncoderError extends Error {
  readonly code: OptimizeWarningCode;

  constructor(code: OptimizeWarningCode, message: string) {
    super(message);
    this.name = 'EncoderError';
    this.code = code;
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Loads (once per loader) and initializes the fallback WebP encoder. Load
 * and WASM init failures are reported as distinct messages; a failed load is
 * not cached, so the next file retries it.
 */
async function loadWebpEncoder(
  loader: () => Promise<WebpEncoderModule>,
): Promise<WebpEncoderModule> {
  let pending = encoderModules.get(loader);
  if (!pending) {
    pending = (async () => {
      let mod: WebpEncoderModule;
      try {
        mod = await loader();
      } catch (err) {
        throw new EncoderError(
          'optimize_failed',
          `WebP fallback encoder could not be imported: ${describe(err)}`,
        );
      }
      try {
        await mod.init?.();
      } catch (err) {
        throw new EncoderError(
          'optimize_failed',
          `WebP fallback encoder could not load its WASM binary: ${describe(err)}`,
        );
      }
      return mod;
    })();
    encoderModules.set(loader, pending);
    pending.catch(() => encoderModules.delete(loader));
  }
  return pending;
}

async function encodeWebp(
  raster: Raster,
  quality: number,
  config: OptimizationConfig,
  deps: OptimizeDeps,
): Promise<Blob> {
  if (await deps.supportsNativeWebp()) {
    return raster.toBlob('image/webp', quality);
  }
  if (!config.webpEncoder) {
    throw new EncoderError(
      'optimize_unsupported',
      'This browser cannot encode WebP and no `webpEncoder` fallback is configured',
    );
  }
  const mod = await loadWebpEncoder(config.webpEncoder);
  let buffer: ArrayBuffer;
  try {
    buffer = await mod.default(raster.imageData(), { quality: quality * 100 });
  } catch (err) {
    throw new EncoderError(
      'optimize_failed',
      `WebP fallback encode failed: ${describe(err)}`,
    );
  }
  return new Blob([buffer], { type: 'image/webp' });
}

function hasSteps(config: OptimizationConfig): boolean {
  return (
    config.resize?.maxSize != null ||
    config.compress?.quality != null ||
    config.convert?.format === 'webp'
  );
}

async function readPrefix(file: File, bytes: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, bytes).arrayBuffer());
}

/**
 * The pipeline behind {@link optimizeImage}. Never rejects: every failure
 * resolves to the untouched input plus a warning.
 */
export async function runOptimize(
  file: File,
  config: OptimizationConfig,
  deps: OptimizeDeps,
): Promise<OptimizeResult> {
  const untouched: OptimizeResult = {
    file,
    optimized: false,
    bytesBefore: file.size,
    bytesAfter: file.size,
  };
  const skip = (
    code: OptimizeWarningCode,
    message: string,
  ): OptimizeResult => ({
    ...untouched,
    warning: { code, file, message },
  });

  if (!file.type.startsWith('image/') || !hasSteps(config)) return untouched;
  if (!ENCODABLE_TYPES.has(file.type)) {
    return skip(
      'optimize_unsupported',
      `${file.type} is uploaded unchanged; only JPEG, PNG and WebP are re-encoded`,
    );
  }

  try {
    const head = await readPrefix(
      file,
      Math.max(PROVENANCE_SCAN_BYTES, ANIMATION_SCAN_BYTES),
    );
    if (hasProvenanceMarker(head)) {
      return skip(
        'optimize_skipped_provenance',
        'The file carries IPTC DigitalSourceType or a C2PA manifest; re-encoding would drop it',
      );
    }
    if (isAnimated(file.type, head.subarray(0, ANIMATION_SCAN_BYTES))) {
      return skip(
        'optimize_unsupported',
        'Animated images are uploaded unchanged',
      );
    }

    const quality = (config.compress?.quality ?? DEFAULT_QUALITY) / 100;
    const target = config.convert?.format === 'webp' ? 'image/webp' : file.type;
    const raster = await deps.rasterize(file, config.resize?.maxSize);

    const blob =
      target === 'image/webp'
        ? await encodeWebp(raster, quality, config, deps)
        : await raster.toBlob(target, quality);

    if (blob.type !== target) {
      return skip(
        'optimize_mislabel',
        `Requested ${target} but the encoder produced ${blob.type || 'an untyped blob'}`,
      );
    }

    const ratio = config.keepIfSmallerRatio ?? DEFAULT_KEEP_IF_SMALLER_RATIO;
    if (!raster.resized && blob.size > ratio * file.size) return untouched;

    let originalVariant: File | undefined;
    if (config.convert?.storeOriginal && target !== file.type) {
      const variant = await raster.toBlob(file.type, quality);
      if (variant.type === file.type) {
        originalVariant = new File([variant], file.name, {
          type: file.type,
          lastModified: Date.now(),
        });
      }
    }

    return {
      file: new File([blob], outputName(file.name, target), {
        type: target,
        lastModified: Date.now(),
      }),
      originalVariant,
      optimized: true,
      bytesBefore: file.size,
      bytesAfter: blob.size,
    };
  } catch (err) {
    return err instanceof EncoderError
      ? skip(err.code, err.message)
      : skip('optimize_failed', describe(err));
  }
}

/**
 * Optimizes one image in the browser before upload. Never rejects: when a
 * step cannot run, the input file comes back unchanged with a `warning`.
 *
 * - Only JPEG, PNG and WebP are re-encoded. Other types, animated WebP/APNG
 *   and files with IPTC `DigitalSourceType` or C2PA provenance are returned
 *   byte-identical.
 * - Resize: downscale so neither side exceeds `resize.maxSize`.
 * - Compress: encode at `compress.quality` (default 82).
 * - Convert: encode to WebP when `convert.format` is `'webp'`; browsers
 *   without native WebP encoding use `webpEncoder`.
 * - Keep if smaller: without a downscale, the result is used only when it is
 *   at most `keepIfSmallerRatio` (default 0.9) of the input size.
 * - The output name and type always follow the encoded format.
 */
export function optimizeImage(
  file: File,
  config: OptimizationConfig,
): Promise<OptimizeResult> {
  return runOptimize(file, config, browserDeps);
}

/**
 * Optimizes `files` one at a time, so at most one decoded bitmap is held in
 * memory. Resolves with one result per input, in order.
 */
export async function optimizeFiles(
  files: File[],
  config: OptimizationConfig,
): Promise<OptimizeResult[]> {
  const results: OptimizeResult[] = [];
  for (const file of files) {
    results.push(await optimizeImage(file, config));
  }
  return results;
}

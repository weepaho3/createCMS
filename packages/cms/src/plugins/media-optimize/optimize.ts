import type { OptimizationConfig } from '../../core/types/s3';

export interface OptimizeResult {
  file: File;
  originalVariant?: File;
  optimized: boolean;
}

function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };
    img.src = url;
  });
}

function calculateDimensions(
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } {
  if (width <= maxSize && height <= maxSize) {
    return { width, height };
  }
  const ratio = width / height;
  if (width > height) {
    return { width: maxSize, height: Math.round(maxSize / ratio) };
  }
  return { width: Math.round(maxSize * ratio), height: maxSize };
}

function drawToCanvas(
  img: HTMLImageElement,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas 2d context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  return canvas;
}

function canvasToBlobAsync(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error(`canvas.toBlob failed for ${mimeType}`)),
      mimeType,
      quality,
    );
  });
}

let _nativeWebpSupported: boolean | null = null;

async function supportsNativeWebp(): Promise<boolean> {
  if (_nativeWebpSupported !== null) return _nativeWebpSupported;
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  const blob = await new Promise<Blob | null>((r) =>
    c.toBlob((b) => r(b), 'image/webp', 0.5),
  );
  _nativeWebpSupported = blob?.type === 'image/webp';
  return _nativeWebpSupported;
}

async function encodeWebp(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  if (await supportsNativeWebp()) {
    return canvasToBlobAsync(canvas, 'image/webp', quality);
  }

  try {
    const { encode } = await import(/* webpackIgnore: true */ '@jsquash/webp');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas 2d context');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const buffer = await encode(imageData, { quality: quality * 100 });
    return new Blob([buffer], { type: 'image/webp' });
  } catch {
    throw new Error(
      'WebP encoding not supported natively and @jsquash/webp is not installed. ' +
        'Install it as a dependency: npm install @jsquash/webp',
    );
  }
}

function inferMimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    avif: 'image/avif',
  };
  return (ext && map[ext]) || 'image/jpeg';
}

function replaceExtension(filename: string, newExt: string): string {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}.${newExt}`;
}

/**
 * Optimize an image file on the client before uploading.
 *
 * - **Resize**: Downscale if either dimension exceeds `config.resize.maxSize`
 * - **Compress**: Reduce quality via `config.compress.quality` (1-100)
 * - **Convert**: Convert to WebP when `config.convert.format` is set
 * - **storeOriginal**: When `convert.storeOriginal` is true, also returns an
 *   `originalVariant` -- same resize + compress but kept in the original format
 *
 * Non-image files are returned unchanged with `optimized: false`.
 */
export async function optimizeImage(
  file: File,
  config: OptimizationConfig,
): Promise<OptimizeResult> {
  if (!isImageFile(file)) {
    return { file, optimized: false };
  }

  const hasResize = !!config.resize?.maxSize;
  const hasCompress = config.compress?.quality != null;
  const hasConvert = config.convert?.format === 'webp';

  if (!hasResize && !hasCompress && !hasConvert) {
    return { file, optimized: false };
  }

  const img = await loadImage(file);
  const maxSize =
    config.resize?.maxSize ?? Math.max(img.naturalWidth, img.naturalHeight);
  const quality =
    config.compress?.quality != null ? config.compress.quality / 100 : 0.8;
  const { width, height } = calculateDimensions(
    img.naturalWidth,
    img.naturalHeight,
    maxSize,
  );

  const canvas = drawToCanvas(img, width, height);

  let originalVariant: File | undefined;

  const originalMime = file.type || inferMimeFromName(file.name);

  if (hasConvert && config.convert!.storeOriginal) {
    const originalBlob = await canvasToBlobAsync(canvas, originalMime, quality);
    originalVariant = new File([originalBlob], file.name, {
      type: originalMime,
      lastModified: Date.now(),
    });
  }

  let primaryBlob: Blob;
  let primaryName: string;
  let primaryType: string;

  if (hasConvert) {
    primaryBlob = await encodeWebp(canvas, quality);
    primaryName = replaceExtension(file.name, 'webp');
    primaryType = 'image/webp';
  } else {
    primaryBlob = await canvasToBlobAsync(canvas, originalMime, quality);
    primaryName = file.name;
    primaryType = originalMime;
  }

  const primaryFile = new File([primaryBlob], primaryName, {
    type: primaryType,
    lastModified: Date.now(),
  });

  return {
    file: primaryFile,
    originalVariant,
    optimized: true,
  };
}

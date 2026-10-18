/**
 * Focal point and crop geometry. Both are fractions of the original image
 * (0 to 1), never pixels: the focal point lives on the asset
 * (`metadata.focal`), a crop on one use (`AssetRef.crop`).
 */

/** A point as fractions of width and height; missing means the center. */
export type FocalPoint = { x: number; y: number };

/** A rectangle as fractions of the original's width and height. */
export type UsageCrop = { x: number; y: number; width: number; height: number };

/** A named aspect a crop or a preview targets, e.g. Open Graph. */
export type CropPreset = {
  id: string;
  label: string;
  /** Width / height; omitted for a free crop. */
  aspect?: number;
  /** Pixels the cropped width must reach. */
  minWidth?: number;
};

export const CENTER: FocalPoint = { x: 0.5, y: 0.5 };

/** Common presets: Open Graph, square, 16:9, 4:3 and portrait 4:5. */
export const DEFAULT_CROP_PRESETS: readonly CropPreset[] = [
  { id: 'og', label: 'Open Graph', aspect: 1200 / 630, minWidth: 1200 },
  { id: 'square', label: '1:1', aspect: 1 },
  { id: 'wide', label: '16:9', aspect: 16 / 9 },
  { id: 'classic', label: '4:3', aspect: 4 / 3 },
  { id: 'portrait', label: '4:5', aspect: 4 / 5 },
];

const clamp01 = (value: number) =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));

export function clampFocal(point: FocalPoint): FocalPoint {
  return { x: clamp01(point.x), y: clamp01(point.y) };
}

/** Arrow keys move 1 percent, with Shift 10 percent. */
export function nudgeFocal(
  point: FocalPoint,
  key: 'left' | 'right' | 'up' | 'down',
  large = false,
): FocalPoint {
  const step = large ? 0.1 : 0.01;
  const dx = key === 'left' ? -step : key === 'right' ? step : 0;
  const dy = key === 'up' ? -step : key === 'down' ? step : 0;
  return clampFocal({ x: round4(point.x + dx), y: round4(point.y + dy) });
}

/** The focal point under a pointer at (`clientX`, `clientY`) in `box`. */
export function focalFromPointer(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
): FocalPoint {
  if (box.width <= 0 || box.height <= 0) return CENTER;
  return clampFocal({
    x: round4((clientX - box.left) / box.width),
    y: round4((clientY - box.top) / box.height),
  });
}

/** Whole percents for labels: `{ x: 42, y: 30 }`. */
export function focalPercent(point: FocalPoint): { x: number; y: number } {
  return { x: Math.round(point.x * 100), y: Math.round(point.y * 100) };
}

/** CSS `object-position` of a focal point. */
export function focalObjectPosition(
  point: FocalPoint | null | undefined,
): string {
  const p = clampFocal(point ?? CENTER);
  return `${round4(p.x * 100)}% ${round4(p.y * 100)}%`;
}

function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * The largest crop with `aspect` (width / height in pixels) inside an image
 * of `imageWidth` x `imageHeight`, centered on `focal` and kept inside the
 * image (Sanity semantics).
 */
export function defaultCrop(
  aspect: number,
  imageWidth: number,
  imageHeight: number,
  focal: FocalPoint = CENTER,
): UsageCrop {
  if (!(aspect > 0) || imageWidth <= 0 || imageHeight <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const imageAspect = imageWidth / imageHeight;
  // In fractions: width / height of the crop relative to the image.
  const width = aspect >= imageAspect ? 1 : aspect / imageAspect;
  const height = aspect >= imageAspect ? imageAspect / aspect : 1;
  const f = clampFocal(focal);
  const x = Math.min(Math.max(f.x - width / 2, 0), 1 - width);
  const y = Math.min(Math.max(f.y - height / 2, 0), 1 - height);
  return normalizeCrop({ x, y, width, height });
}

/** Keeps a crop inside the image with a positive size; rounds to 4 places. */
export function normalizeCrop(crop: UsageCrop): UsageCrop {
  const width = Math.min(
    1,
    Math.max(0.0001, Number.isFinite(crop.width) ? crop.width : 1),
  );
  const height = Math.min(
    1,
    Math.max(0.0001, Number.isFinite(crop.height) ? crop.height : 1),
  );
  const x = Math.min(
    Math.max(Number.isFinite(crop.x) ? crop.x : 0, 0),
    1 - width,
  );
  const y = Math.min(
    Math.max(Number.isFinite(crop.y) ? crop.y : 0, 0),
    1 - height,
  );
  return {
    x: round4(x),
    y: round4(y),
    width: round4(width),
    height: round4(height),
  };
}

/** Whether a crop covers the whole image (equivalent to no crop). */
export function isFullCrop(crop: UsageCrop | null | undefined): boolean {
  if (!crop) return true;
  const c = normalizeCrop(crop);
  return c.x === 0 && c.y === 0 && c.width === 1 && c.height === 1;
}

/** The crop's aspect in pixels for an image of `imageWidth` x `imageHeight`. */
export function cropAspect(
  crop: UsageCrop,
  imageWidth: number,
  imageHeight: number,
): number {
  return (crop.width * imageWidth) / Math.max(crop.height * imageHeight, 1e-9);
}

/**
 * A crop at `zoom` (1 = the largest crop of the aspect, up to 3) around a
 * center, for a zoom slider: zooming shrinks the crop and keeps its center.
 */
export function zoomCrop(
  base: UsageCrop,
  zoom: number,
  center?: FocalPoint,
): UsageCrop {
  const z = Math.min(3, Math.max(1, zoom));
  const width = base.width / z;
  const height = base.height / z;
  const c = center ?? {
    x: base.x + base.width / 2,
    y: base.y + base.height / 2,
  };
  return normalizeCrop({
    x: c.x - width / 2,
    y: c.y - height / 2,
    width,
    height,
  });
}

/**
 * CSS for showing `crop` of an image in a box: `objectViewBox` for browsers
 * with `object-view-box`, else `image` styles for an absolutely placed image
 * inside a wrapper with `overflow: hidden` and `position: relative`. With
 * the image size, `aspectRatio` is the crop's aspect for the wrapper.
 */
export function cropStyles(
  crop: UsageCrop,
  image?: { width: number; height: number },
): {
  objectViewBox: string;
  image: {
    position: 'absolute';
    width: string;
    height: string;
    left: string;
    top: string;
    maxWidth: 'none';
  };
  aspectRatio: number | null;
} {
  const c = normalizeCrop(crop);
  const pct = (v: number) => `${round4(v * 100)}%`;
  return {
    objectViewBox: `inset(${pct(c.y)} ${pct(1 - c.x - c.width)} ${pct(1 - c.y - c.height)} ${pct(c.x)})`,
    image: {
      position: 'absolute',
      width: pct(1 / c.width),
      height: pct(1 / c.height),
      left: pct(-c.x / c.width),
      top: pct(-c.y / c.height),
      maxWidth: 'none',
    },
    aspectRatio: image
      ? round4(cropAspect(c, image.width, image.height))
      : null,
  };
}

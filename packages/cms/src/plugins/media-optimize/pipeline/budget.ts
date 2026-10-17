/** The device facts the worker budget depends on. */
export type DeviceInfo = {
  hardwareConcurrency?: number;
  /** GiB, Chromium only. */
  deviceMemory?: number;
  isIOS?: boolean;
};

/** Files optimized at once: `min(2, cores / 2)`, 1 on iOS or with 4 GiB or less. */
export function workerConcurrency(device: DeviceInfo): number {
  if (device.isIOS) return 1;
  if (device.deviceMemory !== undefined && device.deviceMemory <= 4) return 1;
  const cores = device.hardwareConcurrency ?? 2;
  return Math.max(1, Math.min(2, Math.floor(cores / 2)));
}

/** Base time every file gets, before its per-megapixel share. */
export const BASE_TIMEOUT_MS = 3000;
/** Per-megapixel time for AVIF output, which encodes far slower. */
export const AVIF_TIMEOUT_MS_PER_MEGAPIXEL = 3000;

/**
 * The time one file may take: 3,000 ms plus `msPerMegapixel` (1,500 ms by
 * default) per megapixel of the source, or 3,000 ms per megapixel when AVIF
 * renditions are produced.
 */
export function fileTimeoutMs(
  width: number,
  height: number,
  options: { msPerMegapixel: number; avif: boolean },
): number {
  const megapixels = (width * height) / 1_000_000;
  const perMegapixel = options.avif
    ? Math.max(options.msPerMegapixel, AVIF_TIMEOUT_MS_PER_MEGAPIXEL)
    : options.msPerMegapixel;
  return Math.round(BASE_TIMEOUT_MS + perMegapixel * megapixels);
}

/** Sources above this many megapixels are never decoded. */
export const MAX_DECODE_MEGAPIXELS = 100;

/**
 * The largest canvas iOS Safari allocates (16,777,216 px); a decode for
 * output is sized below it.
 */
export const IOS_MAX_CANVAS_PIXELS = 16_777_216;

/** True for iOS and iPadOS (which reports itself as a Mac with touch). */
export function detectIOS(
  nav: { userAgent?: string; maxTouchPoints?: number } | undefined,
): boolean {
  if (!nav?.userAgent) return false;
  if (/iP(hone|ad|od)/.test(nav.userAgent)) return true;
  return /Macintosh/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 1;
}

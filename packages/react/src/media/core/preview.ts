/**
 * The preview (lightbox) logic: which renderer an asset gets, stepping
 * through the collection, zoom limits and swipe detection. The store's
 * `preview` slice holds the open id, zoom and rotation.
 */

/** The built-in renderer kinds; a registered renderer replaces one by MIME. */
export type PreviewKind =
  | 'image'
  | 'svg'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'fallback';

/**
 * The renderer kind of a MIME type. SVG renders through `<img>` (scripts and
 * external resources are off there), PDF through the browser's inline viewer,
 * everything else unknown as an icon with a download.
 */
export function previewKindOf(mimeType: string): PreviewKind {
  const type = mimeType.toLowerCase();
  if (type === 'image/svg+xml') return 'svg';
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type === 'application/pdf') return 'pdf';
  return 'fallback';
}

export const PREVIEW_MIN_ZOOM = 1;
export const PREVIEW_MAX_ZOOM = 8;
/** Factor of one `+` or `-` step. */
export const PREVIEW_ZOOM_STEP = 1.25;
/** Horizontal movement that turns a drag into a swipe. */
export const SWIPE_DISTANCE_PX = 50;
/** A faster flick counts as a swipe below the distance. */
export const SWIPE_VELOCITY_PX_MS = 0.5;

export function clampZoom(zoom: number): number {
  return Math.min(PREVIEW_MAX_ZOOM, Math.max(PREVIEW_MIN_ZOOM, zoom));
}

/** The zoom after `+` (`in`), `-` (`out`) or `0` (`reset`). */
export function stepZoom(zoom: number, step: 'in' | 'out' | 'reset'): number {
  if (step === 'reset') return PREVIEW_MIN_ZOOM;
  return clampZoom(
    step === 'in' ? zoom * PREVIEW_ZOOM_STEP : zoom / PREVIEW_ZOOM_STEP,
  );
}

/** Double click or tap: fit when zoomed, 100 percent (`natural`) otherwise. */
export function toggleZoom(zoom: number, natural: number): number {
  return zoom > PREVIEW_MIN_ZOOM
    ? PREVIEW_MIN_ZOOM
    : clampZoom(Math.max(natural, 2));
}

/**
 * The id `delta` steps from `id` in `ids`, or `null` at the ends (the
 * preview does not wrap, so the count stays meaningful).
 */
export function previewStep(
  ids: readonly string[],
  id: string,
  delta: 1 | -1,
): string | null {
  const index = ids.indexOf(id);
  if (index === -1) return null;
  return ids[index + delta] ?? null;
}

/** The ids to preload around `id` (the neighbours). */
export function previewNeighbours(
  ids: readonly string[],
  id: string,
): string[] {
  const index = ids.indexOf(id);
  if (index === -1) return [];
  return [ids[index - 1], ids[index + 1]].filter((n): n is string => !!n);
}

export type SwipeResult = 'next' | 'prev' | 'close' | null;

/**
 * What a finished touch drag means: left and right swipes step (mirrored
 * for RTL), a downward swipe closes. A drag counts once it moved
 * `SWIPE_DISTANCE_PX` or was faster than `SWIPE_VELOCITY_PX_MS`; while
 * zoomed in, drags pan instead and never swipe.
 */
export function swipeOf(
  dx: number,
  dy: number,
  ms: number,
  options: { rtl?: boolean; zoomed?: boolean } = {},
): SwipeResult {
  if (options.zoomed) return null;
  const velocity = ms > 0 ? Math.hypot(dx, dy) / ms : 0;
  const far = (d: number) =>
    Math.abs(d) >= SWIPE_DISTANCE_PX || velocity >= SWIPE_VELOCITY_PX_MS;
  if (Math.abs(dy) > Math.abs(dx)) {
    return dy > 0 && far(dy) ? 'close' : null;
  }
  if (!far(dx) || dx === 0) return null;
  const towardsStart = dx > 0;
  return towardsStart !== !!options.rtl ? 'prev' : 'next';
}

/** The rotation after a quarter turn. */
export function rotateQuarter(
  rotation: 0 | 90 | 180 | 270,
): 0 | 90 | 180 | 270 {
  return ((rotation + 90) % 360) as 0 | 90 | 180 | 270;
}

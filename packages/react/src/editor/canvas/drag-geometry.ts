import type { InsertTarget } from './insert';
import type { CanvasRect } from './rect';

/** Edge dead zone of a block: a point this close to its edge belongs to the parent. */
export const HIT_EDGE_PX = 6;
/** Containers taller (or wider, in a row) than this get an edge band. */
export const EDGE_BAND_MIN_SIZE = 120;
/** Width of the band at a container's edge that targets its parent instead. */
export const EDGE_BAND_PX = 30;
/** A new target replaces the current one only after the pointer moved this far, */
export const HYSTERESIS_PX = 10;
/** or when it is this much closer than the current one. */
export const HYSTERESIS_MARGIN_PX = 4;

type Point = { readonly x: number; readonly y: number };

/** `rect` shrunk by `by` on every side (never below zero size). */
export function contractRect(rect: CanvasRect, by: number): CanvasRect {
  const width = Math.max(0, rect.width - 2 * by);
  const height = Math.max(0, rect.height - 2 * by);
  return {
    x: rect.x + Math.min(by, rect.width / 2),
    y: rect.y + Math.min(by, rect.height / 2),
    width,
    height,
  };
}

export function rectContains(rect: CanvasRect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/** Distance from `point` to `rect` (0 inside). */
export function distanceToRect(rect: CanvasRect, point: Point): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/**
 * Whether `point` sits in the edge band of a container: within
 * `EDGE_BAND_PX` of its leading or trailing edge along the parent's flow,
 * on a container at least `EDGE_BAND_MIN_SIZE` long in that direction.
 * Such a point drops before or after the container, not into it.
 */
export function inEdgeBand(
  rect: CanvasRect,
  point: Point,
  parentFlow: 'row' | 'column',
): boolean {
  if (parentFlow === 'row') {
    if (rect.width < EDGE_BAND_MIN_SIZE) return false;
    return (
      point.x - rect.x < EDGE_BAND_PX ||
      rect.x + rect.width - point.x < EDGE_BAND_PX
    );
  }
  if (rect.height < EDGE_BAND_MIN_SIZE) return false;
  return (
    point.y - rect.y < EDGE_BAND_PX ||
    rect.y + rect.height - point.y < EDGE_BAND_PX
  );
}

function sameSlotAndIndex(a: InsertTarget, b: InsertTarget): boolean {
  return (
    a.parent.id === b.parent.id &&
    a.parent.slot === b.parent.slot &&
    a.index === b.index
  );
}

/**
 * Keeps the current target against small pointer jitter: `next` wins only
 * when the pointer moved `HYSTERESIS_PX` since `current` was taken, or
 * `next` is clearly closer than `current`. Returns the target to show and
 * where it was taken.
 */
export function stickyTarget(
  current: { target: InsertTarget; at: Point } | null,
  next: InsertTarget | null,
  point: Point,
): { target: InsertTarget; at: Point } | null {
  if (next === null) return null;
  if (current === null || sameSlotAndIndex(current.target, next)) {
    return {
      target: next,
      at:
        current && sameSlotAndIndex(current.target, next) ? current.at : point,
    };
  }
  const moved = Math.hypot(point.x - current.at.x, point.y - current.at.y);
  if (moved >= HYSTERESIS_PX) return { target: next, at: point };
  const held = distanceToRect(current.target.rect, point);
  const offered = distanceToRect(next.rect, point);
  if (offered + HYSTERESIS_MARGIN_PX < held) return { target: next, at: point };
  return current;
}

/** Auto-scroll tuning, in CSS pixels per second. */
export const AUTO_SCROLL = {
  /** Edge zone: this share of the scroller's size, */
  zoneShare: 0.15,
  /** but never more than this, so most of the canvas stays a plain target. */
  zoneMaxPx: 96,
  /** Speed at the very edge; it eases in quadratically across the zone. */
  speedPxPerSecond: 1000,
  fastSpeedPxPerSecond: 1600,
  /** Speed ramps up over this long after the pointer entered a zone. */
  dampeningMs: 300,
} as const;

/**
 * Scroll speed in px per second for a pointer `distance` px from an edge
 * of a scroller `size` px long, `sinceEnterMs` after it entered the zone.
 * Zero outside the zone, slow at its inner border and full at the edge;
 * independent of the frame rate.
 */
export function autoScrollSpeed(
  distance: number,
  size: number,
  sinceEnterMs: number,
  fast = false,
): number {
  const zone = Math.min(size * AUTO_SCROLL.zoneShare, AUTO_SCROLL.zoneMaxPx);
  if (!(zone > 0) || distance >= zone) return 0;
  const depth = 1 - Math.max(0, distance) / zone;
  const dampen = Math.min(
    1,
    Math.max(0, sinceEnterMs) / AUTO_SCROLL.dampeningMs,
  );
  const max = fast
    ? AUTO_SCROLL.fastSpeedPxPerSecond
    : AUTO_SCROLL.speedPxPerSecond;
  return max * depth * depth * dampen;
}

/** Pointer-type activation of a drag gesture. */
export type DragActivation =
  | { readonly kind: 'distance'; readonly px: number }
  | {
      readonly kind: 'press';
      readonly delayMs: number;
      readonly tolerancePx: number;
    };

/**
 * Touch starts a drag after a 250 ms press that stays within 5 px; a mouse
 * on a drag handle starts on the first movement; a mouse elsewhere and a
 * pen start after 5 px.
 */
export function activationFor(
  pointerType: string,
  onHandle: boolean,
): DragActivation {
  if (pointerType === 'touch') {
    return { kind: 'press', delayMs: 250, tolerancePx: 5 };
  }
  if (pointerType === 'mouse' && onHandle) return { kind: 'distance', px: 0 };
  return { kind: 'distance', px: 5 };
}

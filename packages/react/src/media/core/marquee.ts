import type { CollectionLayout, Rect } from './layout';
import type { SelectionState } from './selection';

import { itemsInRect } from './layout';

/**
 * Marquee (rubber band) selection over layout geometry: the hit test runs
 * against every laid-out rect, so items outside the mounted window of a
 * virtualized collection are selected too.
 */

export type Point = { x: number; y: number };

/** Movement before a press on empty space becomes a marquee. */
export const MARQUEE_ACTIVATION_PX = 6;

/** Auto-scroll edge band: `min(25% of the viewport, 180 px)`. */
export const AUTO_SCROLL_BAND_MAX_PX = 180;
export const AUTO_SCROLL_BAND_RATIO = 0.25;
/** Time over which auto-scroll ramps up to full speed after entering the band. */
export const AUTO_SCROLL_RAMP_MS = 400;
/** Full auto-scroll speed in px per frame. */
export const AUTO_SCROLL_MAX_PX = 24;

export function marqueeRect(start: Point, current: Point): Rect {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  };
}

export function marqueeActivated(
  start: Point,
  current: Point,
  threshold = MARQUEE_ACTIVATION_PX,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}

/** No modifier replaces, Shift adds, Cmd/Ctrl toggles. */
export type MarqueeMode = 'replace' | 'add' | 'toggle';

export function marqueeModeOf(modifiers: {
  range?: boolean;
  toggle?: boolean;
}): MarqueeMode {
  if (modifiers.toggle) return 'toggle';
  if (modifiers.range) return 'add';
  return 'replace';
}

/** The ids under `rect`, in collection order. */
export function marqueeHits(
  layout: CollectionLayout,
  ids: readonly string[],
  rect: Rect,
): string[] {
  return itemsInRect(layout, rect).map((i) => ids[i]);
}

/**
 * The selection while a marquee covers `hits`, computed from the selection
 * at the start of the gesture (`base`), so shrinking the band deselects
 * again.
 */
export function applyMarquee(
  base: SelectionState,
  hits: readonly string[],
  mode: MarqueeMode,
): SelectionState {
  if (base.mode !== 'multiple') return base;
  let selected: string[];
  if (mode === 'replace') {
    selected = [...hits];
  } else if (mode === 'add') {
    const seen = new Set(base.selected);
    selected = [...base.selected, ...hits.filter((id) => !seen.has(id))];
  } else {
    const hit = new Set(hits);
    const kept = base.selected.filter((id) => !hit.has(id));
    const before = new Set(base.selected);
    selected = [...kept, ...hits.filter((id) => !before.has(id))];
  }
  return {
    ...base,
    selected,
    anchor: hits[0] ?? base.anchor,
    rangeEnd: null,
    allMatching: null,
  };
}

/**
 * Px to scroll this frame for a pointer at `pointer` (same axis as
 * `start`/`size`, e.g. client y against the scroller's top and height):
 * negative in the top band, positive in the bottom band, scaled by depth
 * into the band and ramped up over `AUTO_SCROLL_RAMP_MS` since entering it.
 */
export function autoScrollDelta(
  pointer: number,
  start: number,
  size: number,
  msInBand: number,
): number {
  const band = Math.min(size * AUTO_SCROLL_BAND_RATIO, AUTO_SCROLL_BAND_MAX_PX);
  if (band <= 0) return 0;
  const fromStart = pointer - start;
  const fromEnd = start + size - pointer;
  let direction = 0;
  let depth = 0;
  if (fromStart < band) {
    direction = -1;
    depth = 1 - Math.max(0, fromStart) / band;
  } else if (fromEnd < band) {
    direction = 1;
    depth = 1 - Math.max(0, fromEnd) / band;
  }
  if (direction === 0) return 0;
  const ramp = Math.min(1, Math.max(0, msInBand) / AUTO_SCROLL_RAMP_MS);
  return direction * Math.ceil(AUTO_SCROLL_MAX_PX * depth * ramp);
}

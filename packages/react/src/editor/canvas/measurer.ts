import {
  blockElements,
  measureBlock,
  measureField,
  measureSlot,
  measureVisibleBlock,
} from './anchors';
import { adoptRect, type CanvasRect } from './rect';

/** `visible`: a block rect cut by overflow ancestors (see `measureVisibleBlock`). */
export type MeasuredKind = 'block' | 'field' | 'slot' | 'visible';

export type Measurer = {
  subscribe: (listener: () => void) => () => void;
  getVersion: () => number;
  getBlockRect: (id: string) => CanvasRect | null;
  getFieldRect: (id: string, key: string) => CanvasRect | null;
  /** The rect of the element holding slot `slot` of block `id` (`edit.slot.<name>`). */
  getSlotRect: (id: string, slot: string) => CanvasRect | null;
  /** Any measured rect by kind (`visible`: cut by overflow ancestors). */
  get: (kind: MeasuredKind, id: string, key?: string) => CanvasRect | null;
  /**
   * Keeps a rect measured while something shows it (a ring, a toolbar):
   * tracked rects are re-measured every frame something changed and
   * polled every `MEASURE_EVERY_MS`; others are measured on demand.
   * Returns the release function.
   */
  track: (kind: MeasuredKind, id: string, key?: string) => () => void;
  /** Rects measured by the last flush (tracked ones only). */
  stats: () => { readonly lastFlush: number; readonly tracked: number };
  destroy: () => void;
};

/** How often tracked rects are polled for changes no observer reports (transitions). */
export const MEASURE_EVERY_MS = 100;
/** Smaller differences than this do not count as a change. */
const RECT_EPSILON = 0.5;

const SEP = '\0';

const keyOf = (kind: MeasuredKind, id: string, key = ''): string =>
  kind + SEP + id + SEP + key;

function closeEnough(a: CanvasRect | null, b: CanvasRect | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    Math.abs(a.x - b.x) <= RECT_EPSILON &&
    Math.abs(a.y - b.y) <= RECT_EPSILON &&
    Math.abs(a.width - b.width) <= RECT_EPSILON &&
    Math.abs(a.height - b.height) <= RECT_EPSILON
  );
}

/**
 * Measures block, field and slot rects of one canvas in content
 * coordinates. Only tracked rects are kept current: one shared
 * ResizeObserver watches their elements, a MutationObserver on the canvas
 * (ignoring the overlay) and scroll, resize and font loading invalidate,
 * and one animation frame re-measures every tracked rect before anything
 * reads them; a 100 ms poll catches movement no observer reports. Any
 * other rect is measured when asked and forgotten at the next change.
 */
export function createMeasurer(canvasEl: HTMLElement): Measurer {
  const listeners = new Set<() => void>();
  let version = 0;
  const tracked = new Map<string, number>();
  let cache = new Map<string, CanvasRect | null>();
  let raf = 0;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  let lastFlush = 0;

  const doc = canvasEl.ownerDocument;
  const view = doc.defaultView;
  const observed = new Set<Element>();

  const measure = (key: string): CanvasRect | null => {
    const [kind, id, extra] = key.split(SEP) as [MeasuredKind, string, string];
    if (kind === 'block') return measureBlock(canvasEl, id);
    if (kind === 'visible') return measureVisibleBlock(canvasEl, id);
    if (kind === 'field') return measureField(canvasEl, id, extra);
    return measureSlot(canvasEl, id, extra);
  };

  // The last rect handed out per key: an unchanged re-measure returns the
  // same object, so subscriptions see no change.
  const lastSeen = new Map<string, CanvasRect>();
  const read = (key: string): CanvasRect | null => {
    if (cache.has(key)) return cache.get(key) ?? null;
    const measured = measure(key);
    const rect = measured ? adoptRect(lastSeen.get(key), measured) : null;
    if (rect) lastSeen.set(key, rect);
    cache.set(key, rect);
    return rect;
  };

  const notify = () => {
    version += 1;
    for (const listener of listeners) listener();
  };

  // Tracked blocks that are (or sit in) fixed or sticky elements move
  // when the canvas scrolls.
  let followsScroll = false;
  const syncObserved = () => {
    const next = new Set<Element>([canvasEl]);
    followsScroll = false;
    for (const key of tracked.keys()) {
      const id = key.split(SEP)[1]!;
      for (const el of blockElements(canvasEl, id)) {
        next.add(el);
        for (
          let cur: Element | null = el;
          cur && cur !== canvasEl;
          cur = cur.parentElement
        ) {
          const position = view?.getComputedStyle(cur).position;
          if (position === 'fixed' || position === 'sticky')
            followsScroll = true;
        }
      }
    }
    if (!resizeObserver) return;
    for (const el of observed) {
      if (!next.has(el)) {
        resizeObserver.unobserve(el);
        observed.delete(el);
      }
    }
    for (const el of next) {
      if (!observed.has(el)) {
        resizeObserver.observe(el);
        observed.add(el);
      }
    }
  };

  /**
   * Re-measures every tracked rect (reads only), drops on-demand rects,
   * and notifies when a tracked rect moved. With `poll`, only a move past
   * the epsilon counts.
   */
  const flush = (poll = false) => {
    if (destroyed) return;
    const next = new Map<string, CanvasRect | null>();
    let changed = false;
    for (const key of tracked.keys()) {
      const prev = cache.get(key) ?? null;
      const rect = measure(key);
      const kept =
        rect && prev
          ? poll && closeEnough(prev, rect)
            ? prev
            : adoptRect(prev, rect)
          : rect;
      if (kept !== prev) changed = true;
      if (kept) lastSeen.set(key, kept);
      next.set(key, kept);
    }
    lastFlush = tracked.size;
    cache = next;
    if (!poll) syncObserved();
    if (changed) notify();
  };

  const schedule = () => {
    if (destroyed) return;
    // On-demand rects are stale from now on.
    for (const key of cache.keys()) {
      if (!tracked.has(key)) cache.delete(key);
    }
    if (!view) {
      flush();
      return;
    }
    if (raf !== 0) return;
    raf = view.requestAnimationFrame(() => {
      raf = 0;
      flush();
    });
  };

  const poll = () => {
    pollTimer = undefined;
    if (destroyed || tracked.size === 0) return;
    flush(true);
    pollTimer = setTimeout(poll, MEASURE_EVERY_MS);
  };

  const resizeObserver = view?.ResizeObserver
    ? new view.ResizeObserver(() => schedule())
    : null;
  const mutationObserver = view?.MutationObserver
    ? new view.MutationObserver((records) => {
        // The overlay draws inside the canvas host; its own changes move
        // no block.
        const relevant = records.some(
          (record) =>
            !(record.target as Element).closest?.('[data-editor-overlay]'),
        );
        if (relevant) schedule();
      })
    : null;

  if (resizeObserver) {
    resizeObserver.observe(canvasEl);
    observed.add(canvasEl);
  }
  mutationObserver?.observe(canvasEl, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'data-editor-block',
      'data-editor-field',
      'data-editor-slot',
      'data-unresolved',
      'data-editor-readonly',
      'style',
      'class',
    ],
  });

  // Scrollers inside blocks move blocks relative to the canvas.
  const onScroll = (event: Event) => {
    if (event.target === canvasEl || event.target === doc) {
      if (followsScroll) schedule();
      return;
    }
    schedule();
  };
  const onResize = () => schedule();
  view?.addEventListener('resize', onResize);
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true });
  void doc.fonts?.ready.then(() => schedule());

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion: () => version,
    getBlockRect: (id) => read(keyOf('block', id)),
    getFieldRect: (id, key) => read(keyOf('field', id, key)),
    getSlotRect: (id, slot) => read(keyOf('slot', id, slot)),
    get: (kind, id, key) => read(keyOf(kind, id, key)),
    track(kind, id, key) {
      const k = keyOf(kind, id, key);
      tracked.set(k, (tracked.get(k) ?? 0) + 1);
      syncObserved();
      if (pollTimer === undefined) {
        pollTimer = setTimeout(poll, MEASURE_EVERY_MS);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const left = (tracked.get(k) ?? 1) - 1;
        if (left > 0) tracked.set(k, left);
        else {
          tracked.delete(k);
          syncObserved();
        }
      };
    },
    stats: () => ({ lastFlush, tracked: tracked.size }),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (raf !== 0 && view) view.cancelAnimationFrame(raf);
      clearTimeout(pollTimer);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      observed.clear();
      lastSeen.clear();
      view?.removeEventListener('resize', onResize);
      doc.removeEventListener('scroll', onScroll, { capture: true });
      listeners.clear();
    },
  };
}

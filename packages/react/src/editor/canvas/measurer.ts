import { isInsideReadonly, measureBlock, measureField } from './anchors';
import { adoptRect, type CanvasRect } from './rect';

export type Measurer = {
  subscribe: (listener: () => void) => () => void;
  getVersion: () => number;
  getBlockRect: (id: string) => CanvasRect | null;
  getFieldRect: (id: string, key: string) => CanvasRect | null;
  destroy: () => void;
};

const FIELD_SEP = '\0';

function fieldKey(id: string, key: string): string {
  return id + FIELD_SEP + key;
}

function mapsChanged(
  prev: Map<string, CanvasRect>,
  next: Map<string, CanvasRect>,
): boolean {
  if (prev.size !== next.size) return true;
  for (const [key, rect] of next) {
    if (prev.get(key) !== rect) return true;
  }
  return false;
}

export function createMeasurer(canvasEl: HTMLElement): Measurer {
  const listeners = new Set<() => void>();
  let version = 0;
  let blockRects = new Map<string, CanvasRect>();
  let fieldRects = new Map<string, CanvasRect>();
  let raf = 0;
  let destroyed = false;
  let fontsSettled = false;

  const doc = canvasEl.ownerDocument;
  const view = doc.defaultView;
  const observedBlocks = new Set<Element>();

  const ResizeObserverCtor = view?.ResizeObserver;
  const MutationObserverCtor = view?.MutationObserver;

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function getVersion(): number {
    return version;
  }

  function getBlockRect(id: string): CanvasRect | null {
    return blockRects.get(id) ?? null;
  }

  function getFieldRect(id: string, key: string): CanvasRect | null {
    return fieldRects.get(fieldKey(id, key)) ?? null;
  }

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function refreshObserved(blockEls: Element[]): void {
    if (!resizeObserver) return;
    const next = new Set<Element>([canvasEl, ...blockEls]);
    for (const el of observedBlocks) {
      if (!next.has(el)) {
        resizeObserver.unobserve(el);
        observedBlocks.delete(el);
      }
    }
    for (const el of next) {
      if (!observedBlocks.has(el)) {
        resizeObserver.observe(el);
        observedBlocks.add(el);
      }
    }
  }

  function remeasure(): void {
    if (destroyed) return;
    const nextBlocks = new Map<string, CanvasRect>();
    const nextFields = new Map<string, CanvasRect>();
    const blockEls: Element[] = [];
    const ids = new Set<string>();
    const fieldPairs: Array<{ id: string; key: string }> = [];
    const seenField = new Set<string>();

    const nodes = canvasEl.querySelectorAll('[data-editor-block]');
    for (const el of nodes) {
      if (!canvasEl.contains(el) || isInsideReadonly(el, canvasEl)) continue;
      const id = el.getAttribute('data-editor-block');
      if (!id) continue;
      blockEls.push(el);
      ids.add(id);
      for (const field of el.querySelectorAll('[data-editor-field]')) {
        if (field.closest('[data-editor-block]') !== el) continue;
        const key = field.getAttribute('data-editor-field');
        if (!key) continue;
        const fk = fieldKey(id, key);
        if (seenField.has(fk)) continue;
        seenField.add(fk);
        fieldPairs.push({ id, key });
      }
    }

    for (const id of ids) {
      const rect = measureBlock(canvasEl, id);
      if (!rect) continue;
      nextBlocks.set(id, adoptRect(blockRects.get(id), rect));
    }
    for (const { id, key } of fieldPairs) {
      const rect = measureField(canvasEl, id, key);
      if (!rect) continue;
      const fk = fieldKey(id, key);
      nextFields.set(fk, adoptRect(fieldRects.get(fk), rect));
    }

    refreshObserved(blockEls);

    const changed =
      mapsChanged(blockRects, nextBlocks) ||
      mapsChanged(fieldRects, nextFields);
    blockRects = nextBlocks;
    fieldRects = nextFields;
    if (!changed) return;
    version += 1;
    notify();
  }

  function schedule(): void {
    if (destroyed) return;
    if (!view) {
      remeasure();
      return;
    }
    if (raf !== 0) return;
    raf = view.requestAnimationFrame(() => {
      raf = 0;
      remeasure();
    });
  }

  const resizeObserver = ResizeObserverCtor
    ? new ResizeObserverCtor(() => {
        schedule();
      })
    : null;
  const mutationObserver = MutationObserverCtor
    ? new MutationObserverCtor(() => {
        schedule();
      })
    : null;

  if (resizeObserver) {
    resizeObserver.observe(canvasEl);
    observedBlocks.add(canvasEl);
  }
  if (mutationObserver) {
    mutationObserver.observe(canvasEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        'data-editor-block',
        'data-editor-field',
        'data-unresolved',
        'data-editor-readonly',
      ],
    });
  }

  function onResize(): void {
    schedule();
  }
  if (view) {
    view.addEventListener('resize', onResize);
  }

  const fonts = doc.fonts;
  if (fonts) {
    void fonts.ready.then(() => {
      if (destroyed || fontsSettled) return;
      fontsSettled = true;
      schedule();
    });
  }

  remeasure();

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    fontsSettled = true;
    if (raf !== 0 && view) {
      view.cancelAnimationFrame(raf);
      raf = 0;
    }
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    observedBlocks.clear();
    if (view) {
      view.removeEventListener('resize', onResize);
    }
    listeners.clear();
  }

  return {
    subscribe,
    getVersion,
    getBlockRect,
    getFieldRect,
    destroy,
  };
}

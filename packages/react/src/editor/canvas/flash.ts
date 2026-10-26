import type { Op } from '../core/document';
import type { EditorStore } from '../core/store';

import { blockElements } from './anchors';

/** How long a flash attribute (`data-dropped`, `data-flashed`) stays on. */
export const FLASH_MS = 700;

const timers = new WeakMap<
  Element,
  Map<string, ReturnType<typeof setTimeout>>
>();

/**
 * Sets `attr` on the elements of `ids` for `FLASH_MS`. A block that flashes
 * again before that keeps the attribute for the full time from the latest
 * flash.
 */
export function flashBlocks(
  host: HTMLElement,
  ids: readonly string[],
  attr: string,
): void {
  for (const el of ids.flatMap((id) => blockElements(host, id))) {
    let byAttr = timers.get(el);
    if (!byAttr) {
      byAttr = new Map();
      timers.set(el, byAttr);
    }
    clearTimeout(byAttr.get(attr));
    el.setAttribute(attr, '');
    byAttr.set(
      attr,
      setTimeout(() => {
        byAttr.delete(attr);
        el.removeAttribute(attr);
      }, FLASH_MS),
    );
  }
}

/** The blocks an op inserts, moves or changes; removals and replaces have none. */
export function changedBlockIds(ops: readonly Op[]): string[] {
  const ids = new Set<string>();
  for (const op of ops) {
    if (op.op === 'insert') ids.add(op.node.id);
    else if (op.op === 'move' || op.op === 'update') ids.add(op.id);
  }
  return [...ids];
}

/**
 * Flashes the blocks that undo, redo or another client changed with
 * `data-flashed`, after the canvas rendered them. Local edits never flash:
 * the author sees those happen.
 */
export function bindChangeFlash(
  host: HTMLElement,
  store: EditorStore,
): () => void {
  const view = host.ownerDocument.defaultView;
  const frames = new Set<number>();
  const off = store.on('change', ({ ops, origin }) => {
    if (origin !== 'history' && origin !== 'remote') return;
    const ids = changedBlockIds(ops);
    if (ids.length === 0 || !view) return;
    const frame = view.requestAnimationFrame(() => {
      frames.delete(frame);
      flashBlocks(host, ids, 'data-flashed');
    });
    frames.add(frame);
  });
  return () => {
    off();
    for (const frame of frames) view?.cancelAnimationFrame(frame);
  };
}

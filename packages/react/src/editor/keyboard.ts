import * as React from 'react';

import { useEditorContext } from './context';

const EDITABLE = 'input, textarea, select, [contenteditable="true"]';

export type EditorKeyboardOptions = {
  /** Delete/Backspace remove the selected block when the target is not an editable field. */
  delete?: boolean;
  /** Escape clears the selection when the target is not an editable field. */
  escape?: boolean;
};

function isEditableTarget(event: KeyboardEvent): boolean {
  const target = event.target as Element | null;
  return target !== null && target.closest(EDITABLE) !== null;
}

/**
 * Binds undo/redo (and optionally Delete/Escape) to `scopeRef`'s element.
 * Must run under `Editor.Root`. The listener is bubbling, so a consumer
 * `onKeyDown` that calls `preventDefault` disables the built-in handling.
 */
export function useEditorKeyboard(
  scopeRef: React.RefObject<HTMLElement | null>,
  options?: EditorKeyboardOptions,
): void {
  const ctx = useEditorContext('useEditorKeyboard');
  const allowDelete = options?.delete === true;
  const allowEscape = options?.escape === true;
  const store = ctx.store;
  const userId = ctx.userId;
  React.useEffect(() => {
    const el = scopeRef.current;
    if (!el) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      if (mod && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        store.undo();
        return;
      }
      if (mod && key === 'z' && event.shiftKey) {
        event.preventDefault();
        store.redo();
        return;
      }
      if (event.ctrlKey && !event.metaKey && key === 'y') {
        event.preventDefault();
        store.redo();
        return;
      }
      if (
        allowDelete &&
        (event.key === 'Delete' || event.key === 'Backspace')
      ) {
        if (isEditableTarget(event)) return;
        const selected = store.getState().selection[userId]?.selected ?? null;
        if (selected === null) return;
        event.preventDefault();
        store.remove(selected);
        return;
      }
      if (allowEscape && event.key === 'Escape') {
        if (isEditableTarget(event)) return;
        event.preventDefault();
        store.select(null);
      }
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [scopeRef, store, userId, allowDelete, allowEscape]);
}

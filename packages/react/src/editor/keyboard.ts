import * as React from 'react';

import { useEditorContext } from './context';
import { isNode } from './dom';

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
 * The combos `event` matches, most specific first: `mod` stands for Cmd or
 * Ctrl; with Ctrl alone the `ctrl` spelling is tried too.
 */
export function combosOf(event: KeyboardEvent): string[] {
  const key = event.key.toLowerCase();
  const tail = [event.altKey ? 'alt' : null, event.shiftKey ? 'shift' : null];
  const combo = (head: string | null) =>
    [head, ...tail, key].filter((part) => part !== null).join('+');
  const out: string[] = [];
  if (event.metaKey || event.ctrlKey) out.push(combo('mod'));
  if (event.ctrlKey && !event.metaKey) out.push(combo('ctrl'));
  if (!event.metaKey && !event.ctrlKey) out.push(combo(null));
  return out;
}

/**
 * Binds the editor's shortcuts (undo/redo and every plugin combo, see
 * `store.commands.shortcuts()`) and optionally Delete/Escape for keys whose
 * target is inside `scopeRef`. Must run under `Editor.Root`. The listener
 * is bubbling on the document, so a consumer React `onKeyDown` that
 * `preventDefault`s wins.
 */
export function useEditorKeyboard(
  scopeRef: React.RefObject<HTMLElement | null>,
  options?: EditorKeyboardOptions,
): void {
  const ctx = useEditorContext('useEditorKeyboard');
  const allowDelete = options?.delete === true;
  const allowEscape = options?.escape === true;
  const store = ctx.store;
  React.useEffect(() => {
    const el = scopeRef.current;
    if (!el) return;
    const doc = el.ownerDocument;
    const shortcuts = store.commands.shortcuts();
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (!isNode(target) || (target !== el && !el.contains(target))) {
        return;
      }
      if (event.defaultPrevented) return;
      for (const combo of combosOf(event)) {
        const id = shortcuts[combo];
        if (id === undefined) continue;
        event.preventDefault();
        store.commands.execute(id);
        return;
      }
      if (
        allowDelete &&
        (event.key === 'Delete' || event.key === 'Backspace')
      ) {
        if (isEditableTarget(event)) return;
        const selected = store.getSession().selection[0];
        if (selected === undefined) return;
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
    doc.addEventListener('keydown', onKeyDown);
    return () => doc.removeEventListener('keydown', onKeyDown);
  }, [scopeRef, store, allowDelete, allowEscape]);
}

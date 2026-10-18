import * as React from 'react';

import type { EditorStore } from './core/store';

import { useEditorContext } from './context';
import {
  CLIPBOARD_APP,
  CLIPBOARD_MIME,
  CLIPBOARD_VERSION,
  copyBlocks,
  decodeClipboard,
  encodeClipboardHtml,
  pasteBlocks,
  plainTextOf,
  removeSelected,
} from './core/clipboard';
import { isElement, isNode } from './dom';

const EDITABLE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/**
 * Widgets that own their plain keys (Enter, arrows, Tab, Delete): only
 * combos with Mod, Ctrl or Alt reach the editor from inside them.
 */
const WIDGET = [
  'button',
  'a[href]',
  'summary',
  '[role="button"]',
  '[role="treeitem"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="tab"]',
  '[role="toolbar"]',
  '[role="dialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="combobox"]',
  '[role="grid"]',
].join(', ');

function closestOf(target: EventTarget | null, selector: string): boolean {
  if (!isNode(target)) return false;
  const el = isElement(target) ? target : target.parentElement;
  return el !== null && el.closest(selector) !== null;
}

/**
 * The combos `event` matches, most specific first: `mod` stands for Cmd or
 * Ctrl; with Ctrl alone the `ctrl` spelling is tried too. Letters come from
 * the physical key when Alt is held (Alt changes the character on Apple
 * keyboards), and Shift is dropped for punctuation it produced (`?`).
 */
export function combosOf(event: KeyboardEvent): string[] {
  let key = event.key.toLowerCase();
  if (event.altKey && /^Key[A-Z]$/.test(event.code)) {
    key = event.code.slice(3).toLowerCase();
  }
  const punctuation = key.length === 1 && !/[a-z0-9]/.test(key);
  const tail = [
    event.altKey ? 'alt' : null,
    event.shiftKey && !punctuation ? 'shift' : null,
  ];
  const combo = (head: string | null) =>
    [head, ...tail, key].filter((part) => part !== null).join('+');
  const out: string[] = [];
  if (event.metaKey || event.ctrlKey) out.push(combo('mod'));
  if (event.ctrlKey && !event.metaKey) out.push(combo('ctrl'));
  if (!event.metaKey && !event.ctrlKey) out.push(combo(null));
  return out;
}

/**
 * Runs the bound command for `event` (see `store.commands.shortcuts()`).
 * Skips composition, prevented events, plain keys inside widgets and every
 * command not marked `editable` while focus is in an input or editable
 * text. A combo whose command cannot run now leaves the key to the
 * browser. Returns whether a command ran.
 */
export function handleEditorKey(
  store: EditorStore,
  event: KeyboardEvent,
): boolean {
  if (event.defaultPrevented || event.isComposing) return false;
  const editable = closestOf(event.target, EDITABLE);
  const modified = event.metaKey || event.ctrlKey || event.altKey;
  if (!editable && !modified && closestOf(event.target, WIDGET)) return false;
  const shortcuts = store.commands.shortcuts();
  for (const combo of combosOf(event)) {
    const id = shortcuts[combo];
    if (id === undefined) continue;
    const command = store.commands.get(id);
    if (!command || command.native === true) return false;
    if (editable && command.editable !== true) return false;
    if (!store.commands.canExecute(id)) return false;
    event.preventDefault();
    store.commands.execute(id);
    return true;
  }
  return false;
}

/**
 * Routes `keydown` on `doc` to the editor's shortcuts (`handleEditorKey`),
 * for keys whose target is inside `scope` (the whole document without
 * one). Bind it once per document: the host page and each same-origin
 * preview frame, whose key events never reach the host. Returns the unbind
 * function.
 */
export function bindEditorKeyboard(
  store: EditorStore,
  doc: Document,
  scope?: Node,
): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    if (scope && (!isNode(target) || !scope.contains(target))) return;
    handleEditorKey(store, event);
  };
  doc.addEventListener('keydown', onKeyDown);
  return () => doc.removeEventListener('keydown', onKeyDown);
}

/** True while the user has text selected (their copy is text, not blocks). */
function hasTextSelection(doc: Document): boolean {
  const selection = doc.getSelection();
  return selection !== null && !selection.isCollapsed;
}

/**
 * Handles the browser's `copy`, `cut` and `paste` events on `doc` for
 * blocks: copy writes `text/html` with the embedded payload plus
 * `text/plain`; paste reads the editor's format, then the HTML attribute,
 * then hands foreign content to the plugins' `convertForeignPaste`. Events
 * from inputs and editable text, and copies of selected text, stay with
 * the browser. Returns the unbind function.
 */
export function bindEditorClipboard(
  store: EditorStore,
  doc: Document,
  scope?: Node,
): () => void {
  /** The event's data when the editor handles it, else `null`. */
  const dataOf = (event: ClipboardEvent): DataTransfer | null => {
    const target = event.target;
    if (event.defaultPrevented || !event.clipboardData) return null;
    if (scope && (!isNode(target) || !scope.contains(target))) {
      // Clipboard events target the focused element, often `body`.
      const active = doc.activeElement;
      if (active !== doc.body && !(active && scope.contains(active))) {
        return null;
      }
    }
    return closestOf(target, EDITABLE) ? null : event.clipboardData;
  };
  const onCopy = (event: ClipboardEvent) => {
    const data = dataOf(event);
    if (!data || hasTextSelection(doc)) return;
    const payload = copyBlocks(store);
    if (!payload || payload.kind !== 'blocks') return;
    const text = plainTextOf(payload.blocks);
    data.setData('text/html', encodeClipboardHtml(payload, text));
    data.setData('text/plain', text);
    event.preventDefault();
    if (event.type === 'cut') removeSelected(store);
  };
  const onPaste = (event: ClipboardEvent) => {
    const data = dataOf(event);
    if (!data) return;
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    let payload = decodeClipboard({ json: data.getData(CLIPBOARD_MIME), html });
    if (!payload) {
      for (const plugin of store.plugins) {
        const blocks = plugin.convertForeignPaste?.({ html, text }, store);
        if (blocks && blocks.length > 0) {
          payload = {
            app: CLIPBOARD_APP,
            version: CLIPBOARD_VERSION,
            kind: 'blocks',
            blocks,
          };
          break;
        }
      }
    }
    if (!payload) return;
    event.preventDefault();
    pasteBlocks(store, payload);
  };
  doc.addEventListener('copy', onCopy);
  doc.addEventListener('cut', onCopy);
  doc.addEventListener('paste', onPaste);
  return () => {
    doc.removeEventListener('copy', onCopy);
    doc.removeEventListener('cut', onCopy);
    doc.removeEventListener('paste', onPaste);
  };
}

/**
 * Binds the editor's shortcuts and block clipboard for events whose target
 * is inside `scopeRef`. Must run under `Editor.Root`. The listener is bubbling on the document,
 * so a consumer React `onKeyDown` that `preventDefault`s wins.
 */
export function useEditorKeyboard(
  scopeRef: React.RefObject<HTMLElement | null>,
): void {
  const { store } = useEditorContext('useEditorKeyboard');
  React.useEffect(() => {
    const el = scopeRef.current;
    if (!el) return;
    const unbindKeys = bindEditorKeyboard(store, el.ownerDocument, el);
    const unbindClipboard = bindEditorClipboard(store, el.ownerDocument, el);
    return () => {
      unbindKeys();
      unbindClipboard();
    };
  }, [scopeRef, store]);
}

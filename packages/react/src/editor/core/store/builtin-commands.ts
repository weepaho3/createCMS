import type { FlatNode } from '../document';
import type { EditorCommand, EditorStore, UiAction } from './types';

import { clipboardCommands } from '../clipboard';
import { EN_MESSAGES } from '../messages';
import { canPlaceIn, DEFAULT_SLOT, slotsOf } from '../schema';

/**
 * The default combos (`Mod` is Cmd on Apple platforms, Ctrl elsewhere). A
 * plugin's `shortcuts` override them; an empty id unbinds a combo.
 */
export const DEFAULT_SHORTCUTS: Readonly<Record<string, string>> = {
  'Mod+z': 'history.undo',
  'Mod+Shift+z': 'history.redo',
  'Ctrl+y': 'history.redo',
  'Mod+c': 'clipboard.copy',
  'Mod+x': 'clipboard.cut',
  'Mod+v': 'clipboard.paste',
  'Mod+Alt+c': 'clipboard.copyProps',
  'Mod+Alt+v': 'clipboard.pasteProps',
  'Mod+d': 'block.duplicate',
  'Mod+Shift+d': 'block.duplicate',
  Delete: 'block.remove',
  Backspace: 'block.remove',
  'Alt+ArrowUp': 'block.moveUp',
  'Alt+ArrowDown': 'block.moveDown',
  'Mod+g': 'block.wrap',
  Escape: 'selection.parent',
  'Shift+Enter': 'selection.parent',
  Enter: 'selection.firstChild',
  Tab: 'selection.next',
  'Shift+Tab': 'selection.previous',
  'Mod+a': 'selection.siblings',
  'Mod+k': 'ui.commandPalette',
  '/': 'ui.quickInsert',
  'Alt+F10': 'ui.toolbar',
  '?': 'ui.shortcutHelp',
  'Mod+/': 'ui.shortcutHelp',
};

const label = (id: string): string | undefined => EN_MESSAGES.commands[id];

function primary(store: EditorStore): FlatNode | null {
  const [id] = store.getSession().selection;
  if (id === undefined) return null;
  return store.getDoc().nodes[id] ?? null;
}

/** The primary selection when it is a block (not the root). */
function selectedBlock(store: EditorStore): FlatNode | null {
  const node = primary(store);
  return node && node.parent !== null ? node : null;
}

function siblingsOf(store: EditorStore, node: FlatNode): readonly string[] {
  if (node.parent === null) return [];
  const parent = store.getDoc().nodes[node.parent.id];
  return parent?.slots[node.parent.slot] ?? [];
}

function firstChildOf(store: EditorStore, node: FlatNode): string | null {
  const order = [
    ...Object.keys(slotsOf(store.schema, node.type)),
    ...Object.keys(node.slots),
  ];
  for (const slot of order) {
    const first = node.slots[slot]?.[0];
    if (first !== undefined) return first;
  }
  return null;
}

function step(store: EditorStore, delta: 1 | -1): string | null {
  const node = selectedBlock(store);
  if (!node) return null;
  const siblings = siblingsOf(store, node);
  return siblings[siblings.indexOf(node.id) + delta] ?? null;
}

function moveBy(store: EditorStore, delta: 1 | -1): boolean {
  const node = selectedBlock(store);
  if (!node || node.parent === null) return false;
  const siblings = siblingsOf(store, node);
  const index = siblings.indexOf(node.id) + delta;
  if (index < 0 || index >= siblings.length) return false;
  return store.move(node.id, { parent: node.parent, index });
}

/**
 * The first block type that fits where `node` is and takes `node` in its
 * default slot: what `block.wrap` uses without a `type` argument.
 */
function wrapTypeFor(store: EditorStore, node: FlatNode): string | null {
  if (node.parent === null) return null;
  const { nodes } = store.getDoc();
  for (const type of Object.keys(store.schema.components)) {
    if (!(DEFAULT_SLOT in slotsOf(store.schema, type))) continue;
    if (!canPlaceIn(store.schema, nodes, type, node.parent).ok) continue;
    const probe = { ...nodes, __wrap__: { ...node, id: '__wrap__', type } };
    const inner = canPlaceIn(store.schema, probe, node.type, {
      id: '__wrap__',
      slot: DEFAULT_SLOT,
    });
    if (inner.ok) return type;
  }
  return null;
}

function wrapArgs(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const type = (args as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

/**
 * The selection, structure and UI commands every store has. `requestUi`
 * emits the `ui` event the React parts listen to.
 */
export function builtinCommands(
  requestUi: (action: UiAction) => void,
): EditorCommand[] {
  const ui = (
    id: string,
    action: UiAction,
    editable = false,
  ): EditorCommand => ({
    id,
    label: label(id),
    editable,
    run: () => requestUi(action),
  });
  return [
    {
      id: 'history.undo',
      label: label('history.undo'),
      editable: true,
      run: (s) => s.undo(),
      canExecute: (s) => s.getSession().history.canUndo,
    },
    {
      id: 'history.redo',
      label: label('history.redo'),
      editable: true,
      run: (s) => s.redo(),
      canExecute: (s) => s.getSession().history.canRedo,
    },
    {
      id: 'block.remove',
      label: label('block.remove'),
      run: (s) => {
        const node = selectedBlock(s);
        if (!node) return false;
        const siblings = siblingsOf(s, node);
        const at = siblings.indexOf(node.id);
        const next =
          siblings[at + 1] ?? siblings[at - 1] ?? node.parent?.id ?? null;
        if (!s.remove(node.id)) return false;
        s.select(next === s.getDoc().rootId ? null : next);
        return true;
      },
      canExecute: (s) => selectedBlock(s) !== null,
    },
    {
      id: 'block.duplicate',
      label: label('block.duplicate'),
      run: (s) => {
        const node = selectedBlock(s);
        if (!node) return null;
        const copy = s.duplicate(node.id);
        if (copy) s.select(copy);
        return copy;
      },
      canExecute: (s) => selectedBlock(s) !== null,
    },
    {
      id: 'block.moveUp',
      label: label('block.moveUp'),
      run: (s) => moveBy(s, -1),
      canExecute: (s) => step(s, -1) !== null,
    },
    {
      id: 'block.moveDown',
      label: label('block.moveDown'),
      run: (s) => moveBy(s, 1),
      canExecute: (s) => step(s, 1) !== null,
    },
    {
      id: 'block.wrap',
      label: label('block.wrap'),
      run: (s, args) => {
        const node = selectedBlock(s);
        if (!node) return null;
        const type = wrapArgs(args) ?? wrapTypeFor(s, node);
        if (type === null) return null;
        const wrapper = s.wrap(node.id, type);
        if (wrapper) s.select(wrapper);
        return wrapper;
      },
      canExecute: (s, args) => {
        const node = selectedBlock(s);
        if (!node) return false;
        return wrapArgs(args) !== undefined || wrapTypeFor(s, node) !== null;
      },
    },
    {
      id: 'selection.parent',
      label: label('selection.parent'),
      run: (s) => {
        const node = primary(s);
        const parent = node?.parent?.id ?? null;
        s.select(
          parent === null || parent === s.getDoc().rootId ? null : parent,
        );
      },
      canExecute: (s) => s.getSession().selection.length > 0,
    },
    {
      id: 'selection.firstChild',
      label: label('selection.firstChild'),
      run: (s) => {
        const node = primary(s);
        const child = node ? firstChildOf(s, node) : null;
        if (child !== null) s.select(child);
      },
      canExecute: (s) => {
        const node = primary(s);
        return node !== null && firstChildOf(s, node) !== null;
      },
    },
    {
      id: 'selection.next',
      label: label('selection.next'),
      run: (s) => s.select(step(s, 1)),
      canExecute: (s) => step(s, 1) !== null,
    },
    {
      id: 'selection.previous',
      label: label('selection.previous'),
      run: (s) => s.select(step(s, -1)),
      canExecute: (s) => step(s, -1) !== null,
    },
    {
      id: 'selection.siblings',
      label: label('selection.siblings'),
      run: (s) => {
        const node = selectedBlock(s);
        if (!node) return;
        const siblings = siblingsOf(s, node);
        // The primary selection stays first.
        s.setSelection([node.id, ...siblings.filter((id) => id !== node.id)]);
      },
      canExecute: (s) => selectedBlock(s) !== null,
    },
    ...clipboardCommands(),
    ui('ui.commandPalette', 'commandPalette'),
    ui('ui.quickInsert', 'quickInsert'),
    // Alt+F10 reaches the toolbar from inline text too.
    ui('ui.toolbar', 'toolbar', true),
    ui('ui.shortcutHelp', 'shortcutHelp'),
  ];
}

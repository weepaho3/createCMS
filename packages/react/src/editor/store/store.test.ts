import type { BlockTreeNode } from '@createcms/schema';

import { describe, expect, it, vi } from 'vitest';

import type {
  CreateEditorStoreOptions,
  EditorCallbacks,
  EditorOp,
} from './types';

import { counterGenId, fakeClock, makeTree, storeSchema } from './fixtures';
import { createBlockId } from './id';
import { createEditorStore } from './store';

function makeStore(overrides: Partial<CreateEditorStoreOptions> = {}) {
  const clock = fakeClock();
  const callbacks: EditorCallbacks = {};
  const store = createEditorStore({
    schema: storeSchema,
    initialTree: makeTree(),
    genId: counterGenId(),
    now: clock.now,
    getCallbacks: () => callbacks,
    ...overrides,
  });
  return { store, clock, callbacks };
}

describe('initial state', () => {
  it('starts from the initial tree with clean history', () => {
    const { store } = makeStore();
    const state = store.getState();
    expect(state.rootId).toBe('root_1');
    expect(Object.keys(state.nodes)).toHaveLength(4);
    expect(store.isDirty()).toBe(false);
    expect(store.getTree()).toEqual(makeTree());
    expect(state.version).toBe(0);
    expect(state.savedVersion).toBe(0);
    expect(state.selection.local).toEqual({
      selected: null,
      hovered: null,
      focus: null,
      editing: null,
    });
    expect(state.history).toEqual({ past: [], future: [] });
  });
});

describe('add', () => {
  it('appends the new block at the end of root, selects it, marks dirty', () => {
    const { store } = makeStore();
    const id = store.add('heading', { parentId: 'root_1' });
    expect(id).toBe('n1');
    expect(store.getState().nodes.root_1?.childIds).toEqual([
      'h1',
      'sec1',
      'n1',
    ]);
    expect(store.getState().selection.local?.selected).toBe('n1');
    expect(store.isDirty()).toBe(true);
    expect(store.getState().version).toBe(1);
    expect(store.getState().history.past).toHaveLength(1);
    expect(store.getState().history.future).toHaveLength(0);
  });

  it('inserts at an explicit index', () => {
    const { store } = makeStore();
    store.add('heading', { parentId: 'root_1', index: 0 });
    expect(store.getState().nodes.root_1?.childIds).toEqual([
      'n1',
      'h1',
      'sec1',
    ]);
  });

  it('seeds declared defaults; caller-supplied properties win', () => {
    const { store } = makeStore();
    const id1 = store.add('heading', { parentId: 'root_1' });
    expect(store.getState().nodes[id1 ?? '']?.properties).toEqual({ level: 2 });
    const id2 = store.add('heading', {
      parentId: 'root_1',
      properties: { level: 5 },
    });
    expect(store.getState().nodes[id2 ?? '']?.properties).toEqual({ level: 5 });
  });

  it('seeds only declared defaults for image (alt), never url', () => {
    const { store } = makeStore();
    const id = store.add('image', { parentId: 'root_1' });
    expect(store.getState().nodes[id ?? '']?.properties).toEqual({ alt: '' });
  });

  it('drops undefined caller properties', () => {
    const { store } = makeStore();
    const id = store.add('heading', {
      parentId: 'root_1',
      properties: { text: undefined, level: 3 },
    });
    expect(store.getState().nodes[id ?? '']?.properties).toEqual({ level: 3 });
  });

  it('rejects an unknown parent and changes nothing', () => {
    const { store } = makeStore();
    const result = store.add('heading', { parentId: 'ghost' });
    expect(result).toBeNull();
    expect(store.getState().version).toBe(0);
    expect(Object.keys(store.getState().nodes)).toHaveLength(4);
  });

  it('respects the section whitelist: image rejected, heading allowed', () => {
    const { store } = makeStore();
    expect(store.add('image', { parentId: 'sec1' })).toBeNull();
    const id = store.add('heading', { parentId: 'sec1' });
    expect(id).not.toBeNull();
    expect(store.getState().nodes.sec1?.childIds).toContain(id);
  });

  it('rejects placement into a non-container leaf', () => {
    const { store } = makeStore();
    expect(store.add('heading', { parentId: 'h1' })).toBeNull();
  });

  it('calls onChange once with the add op, version and getTree', () => {
    const { store, callbacks } = makeStore();
    const onChange = vi.fn();
    callbacks.onChange = onChange;
    store.add('heading', { parentId: 'root_1' });
    expect(onChange).toHaveBeenCalledTimes(1);
    const change = onChange.mock.calls[0]?.[0];
    expect(change.ops[0].op).toBe('add');
    expect(change.version).toBe(1);
    expect(change.getTree()).toEqual(store.getTree());
  });
});

describe('update', () => {
  it('merges values and deletes null keys', () => {
    const { store } = makeStore();
    store.update('h1', { text: 'Changed', level: null });
    expect(store.getState().nodes.h1?.properties).toEqual({ text: 'Changed' });
  });

  it('normalises undefined to null before emitting the op', () => {
    const { store, callbacks } = makeStore();
    const onChange = vi.fn();
    callbacks.onChange = onChange;
    store.update('h1', { level: undefined });
    expect(store.getState().nodes.h1?.properties).toEqual({ text: 'Hello' });
    const change = onChange.mock.calls[0]?.[0];
    expect(change.ops[0]).toEqual({
      op: 'update',
      id: 'h1',
      patch: { level: null },
    });
  });

  it('returns false for an unknown id', () => {
    const { store } = makeStore();
    expect(store.update('ghost', { a: 1 })).toBe(false);
  });

  it('preserves undeclared root keys after an update', () => {
    const { store } = makeStore();
    store.update('root_1', { title: 'New Home' });
    expect(store.getTree().properties).toEqual({
      title: 'New Home',
      __slug: 'home',
    });
  });

  it('is clean again after changing a value back by hand', () => {
    const { store } = makeStore();
    store.update('h1', { text: 'Changed' });
    expect(store.isDirty()).toBe(true);
    store.update('h1', { text: 'Hello' });
    expect(store.isDirty()).toBe(false);
  });

  it('never serialises a null property after a delete', () => {
    const { store } = makeStore();
    store.update('h1', { level: null });
    const tree = store.getTree();
    const heading = tree.children.find((c) => c.blockId === 'h1');
    expect(Object.values(heading?.properties ?? {})).not.toContain(null);
  });
});

describe('move', () => {
  it('reparents a block', () => {
    const { store } = makeStore();
    expect(store.move('h1', 'sec1', 0)).toBe(true);
    expect(store.getState().nodes.root_1?.childIds).toEqual(['sec1']);
    expect(store.getState().nodes.sec1?.childIds).toEqual(['h1', 'p1']);
  });

  it('reorders within the same parent', () => {
    const { store } = makeStore();
    store.move('h1', 'root_1', 1);
    expect(store.getState().nodes.root_1?.childIds).toEqual(['sec1', 'h1']);
  });

  it('rejects a cyclical move and changes nothing', () => {
    const { store } = makeStore();
    const before = store.getState();
    expect(store.move('sec1', 'sec1', 0)).toBe(false);
    expect(store.getState()).toBe(before);
  });

  it('rejects moving the root', () => {
    const { store } = makeStore();
    expect(store.move('root_1', 'sec1', 0)).toBe(false);
  });

  it('enforces placement on move (an ad-hoc image is rejected by the section whitelist)', () => {
    const { store } = makeStore();
    expect(store.move('h1', 'sec1', 0)).toBe(true);
    const imageId = store.add('image', { parentId: 'root_1' });
    expect(store.move(imageId ?? '', 'sec1', 0)).toBe(false);
  });

  it('rejects an unknown target', () => {
    const { store } = makeStore();
    expect(store.move('h1', 'ghost', 0)).toBe(false);
  });
});

describe('remove', () => {
  it('cascades: removes the block and its subtree', () => {
    const { store } = makeStore();
    store.remove('sec1');
    expect(store.getState().nodes.sec1).toBeUndefined();
    expect(store.getState().nodes.p1).toBeUndefined();
    expect(store.getState().nodes.root_1?.childIds).toEqual(['h1']);
  });

  it('clears selection fields that pointed into the removed subtree', () => {
    const { store } = makeStore();
    store.select('p1');
    store.hover('sec1');
    store.focus({ blockId: 'p1', key: 'text' });
    store.setEditing({ blockId: 'p1', key: 'text' });
    store.remove('sec1');
    expect(store.getState().selection.local).toEqual({
      selected: null,
      hovered: null,
      focus: null,
      editing: null,
    });
  });

  it('rejects removing the root', () => {
    const { store } = makeStore();
    expect(store.remove('root_1')).toBe(false);
  });

  it('rejects an unknown id', () => {
    const { store } = makeStore();
    expect(store.remove('ghost')).toBe(false);
  });
});

describe('duplicate', () => {
  it('copies a leaf right after the original, selects the copy, marks dirty', () => {
    const { store } = makeStore();
    const id = store.duplicate('h1');
    expect(id).toBe('n1');
    expect(store.getState().nodes.root_1?.childIds).toEqual([
      'h1',
      'n1',
      'sec1',
    ]);
    expect(store.getState().nodes.n1?.properties).toEqual({
      text: 'Hello',
      level: 1,
    });
    expect(store.getState().selection.local?.selected).toBe('n1');
    expect(store.isDirty()).toBe(true);
  });

  it('deep-copies a subtree with fresh ids and rewires the parent links', () => {
    const { store } = makeStore();
    store.duplicate('sec1');
    expect(store.getState().nodes.n1?.type).toBe('section');
    expect(store.getState().nodes.n2?.type).toBe('paragraph');
    expect(store.getState().nodes.n2?.parentId).toBe('n1');
  });

  it('the copy is independent of the original', () => {
    const { store } = makeStore();
    const id = store.duplicate('h1');
    store.update(id ?? '', { text: 'Copy text' });
    expect(store.getState().nodes.h1?.properties.text).toBe('Hello');
  });

  it('rejects duplicating the root', () => {
    const { store } = makeStore();
    expect(store.duplicate('root_1')).toBeNull();
  });

  it('emits a single add op carrying the copied subtree', () => {
    const { store, callbacks } = makeStore();
    const onChange = vi.fn();
    callbacks.onChange = onChange;
    store.duplicate('sec1');
    const change = onChange.mock.calls[0]?.[0];
    expect(change.ops).toHaveLength(1);
    expect(change.ops[0].op).toBe('add');
    expect(change.ops[0].node.blockId).toBe('n1');
  });
});

describe('undo/redo', () => {
  it('undoes an add back to the original tree', () => {
    const { store } = makeStore();
    store.add('heading', { parentId: 'root_1' });
    expect(store.undo()).toBe(true);
    expect(store.getTree()).toEqual(makeTree());
    expect(store.isDirty()).toBe(false);
    expect(store.getState().history.future).toHaveLength(1);
  });

  it('redoes back to the changed tree', () => {
    const { store } = makeStore();
    store.add('heading', { parentId: 'root_1' });
    store.undo();
    expect(store.redo()).toBe(true);
    expect(store.isDirty()).toBe(true);
  });

  it('undo/redo on empty history is a no-op', () => {
    const { store } = makeStore();
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(false);
    expect(store.getState().version).toBe(0);
  });

  describe('roundtrip per action', () => {
    it('add', () => {
      const { store } = makeStore();
      store.add('heading', { parentId: 'root_1' });
      const afterAction = store.getTree();
      store.undo();
      expect(store.getTree()).toEqual(makeTree());
      store.redo();
      expect(store.getTree()).toEqual(afterAction);
    });

    it('update', () => {
      const { store } = makeStore();
      store.update('h1', { text: 'Changed' });
      const afterAction = store.getTree();
      store.undo();
      expect(store.getTree()).toEqual(makeTree());
      store.redo();
      expect(store.getTree()).toEqual(afterAction);
    });

    it('move (reparent)', () => {
      const { store } = makeStore();
      store.move('h1', 'sec1', 0);
      const afterAction = store.getTree();
      store.undo();
      expect(store.getTree()).toEqual(makeTree());
      store.redo();
      expect(store.getTree()).toEqual(afterAction);
    });

    it("remove('sec1')", () => {
      const { store } = makeStore();
      store.remove('sec1');
      const afterAction = store.getTree();
      store.undo();
      expect(store.getTree()).toEqual(makeTree());
      store.redo();
      expect(store.getTree()).toEqual(afterAction);
    });

    it("duplicate('sec1')", () => {
      const { store } = makeStore();
      store.duplicate('sec1');
      const afterAction = store.getTree();
      store.undo();
      expect(store.getTree()).toEqual(makeTree());
      store.redo();
      expect(store.getTree()).toEqual(afterAction);
    });
  });

  it('undo/redo call onChange with the inverse/forward ops respectively', () => {
    const { store, callbacks } = makeStore();
    store.add('heading', { parentId: 'root_1' });
    const onChange = vi.fn();
    callbacks.onChange = onChange;
    store.undo();
    expect(onChange.mock.calls[0]?.[0].ops[0].op).toBe('remove');
    store.redo();
    expect(onChange.mock.calls[1]?.[0].ops[0].op).toBe('add');
  });

  it('undo of an add clears local.selected when the block disappears', () => {
    const { store } = makeStore();
    store.add('heading', { parentId: 'root_1' });
    expect(store.getState().selection.local?.selected).toBe('n1');
    store.undo();
    expect(store.getState().selection.local?.selected).toBeNull();
  });
});

describe('coalescing', () => {
  it('collapses five rapid coalesced updates into one entry undone by a single undo()', () => {
    const { store, clock } = makeStore();
    for (const v of ['H', 'He', 'Hel', 'Hell', 'Hallo']) {
      store.update('h1', { text: v }, { coalesce: true });
      clock.advance(50);
    }
    expect(store.getState().history.past).toHaveLength(1);
    store.undo();
    expect(store.getState().nodes.h1?.properties.text).toBe('Hello');
  });

  it('the merged entry keeps every op; inverse[0] undoes the LAST update first', () => {
    const { store, clock } = makeStore();
    for (const v of ['H', 'He', 'Hel']) {
      store.update('h1', { text: v }, { coalesce: true });
      clock.advance(50);
    }
    const entry = store.getState().history.past[0];
    expect(entry?.ops).toHaveLength(3);
    expect(entry?.inverse[0]).toEqual({
      op: 'update',
      id: 'h1',
      patch: { text: 'He' },
    });
  });

  it('a coalesced update after the window elapses starts a new entry', () => {
    const { store, clock } = makeStore();
    store.update('h1', { text: 'A' }, { coalesce: true });
    clock.advance(401);
    store.update('h1', { text: 'B' }, { coalesce: true });
    expect(store.getState().history.past).toHaveLength(2);
  });

  it('a non-coalesced update always starts a new entry', () => {
    const { store } = makeStore();
    store.update('h1', { text: 'A' }, { coalesce: true });
    store.update('h1', { text: 'B' });
    expect(store.getState().history.past).toHaveLength(2);
  });

  it('different coalesce keys start separate entries', () => {
    const { store } = makeStore();
    store.update('h1', { text: 'A' }, { coalesce: true });
    store.update('h1', { level: 3 }, { coalesce: true });
    expect(store.getState().history.past).toHaveLength(2);
  });

  it('select() breaks the coalescing window', () => {
    const { store } = makeStore();
    store.update('h1', { text: 'A' }, { coalesce: true });
    store.select('p1');
    store.update('h1', { text: 'B' }, { coalesce: true });
    expect(store.getState().history.past).toHaveLength(2);
  });

  it('focus()/setEditing() break the coalescing window', () => {
    const { store: storeA } = makeStore();
    storeA.update('h1', { text: 'A' }, { coalesce: true });
    storeA.focus({ blockId: 'h1', key: 'text' });
    storeA.update('h1', { text: 'B' }, { coalesce: true });
    expect(storeA.getState().history.past).toHaveLength(2);

    const { store: storeB } = makeStore();
    storeB.update('h1', { text: 'A' }, { coalesce: true });
    storeB.setEditing({ blockId: 'h1', key: 'text' });
    storeB.update('h1', { text: 'B' }, { coalesce: true });
    expect(storeB.getState().history.past).toHaveLength(2);
  });

  it('hover() does NOT break the coalescing window', () => {
    const { store } = makeStore();
    store.update('h1', { text: 'A' }, { coalesce: true });
    store.hover('p1');
    store.update('h1', { text: 'B' }, { coalesce: true });
    expect(store.getState().history.past).toHaveLength(1);
  });

  it('a coalesced update after undo() starts its own new entry', () => {
    const { store } = makeStore();
    store.update('h1', { text: 'A' }, { coalesce: true });
    store.undo();
    store.update('h1', { text: 'B' }, { coalesce: true });
    expect(store.getState().history.past).toHaveLength(1);
    expect(store.getState().history.past[0]?.ops).toHaveLength(1);
  });
});

describe('applyRemote', () => {
  it('applies a remote update: bumps version, notifies, leaves history empty, no onChange, dirty becomes true', () => {
    const { store, callbacks } = makeStore();
    const onChange = vi.fn();
    callbacks.onChange = onChange;
    const listener = vi.fn();
    store.subscribe(listener);
    const result = store.applyRemote([
      { op: 'update', id: 'h1', patch: { text: 'Remote' } },
    ]);
    expect(result.applied).toHaveLength(1);
    expect(store.getState().nodes.h1?.properties.text).toBe('Remote');
    expect(store.getState().version).toBe(1);
    expect(listener).toHaveBeenCalled();
    expect(store.getState().history.past).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
    expect(store.isDirty()).toBe(true);
  });

  it('skips a rejected op (unknown id) while the others apply', () => {
    const { store } = makeStore();
    const unknownOp: EditorOp = { op: 'update', id: 'ghost', patch: { a: 1 } };
    const knownOp: EditorOp = { op: 'update', id: 'h1', patch: { text: 'X' } };
    const result = store.applyRemote([unknownOp, knownOp]);
    expect(result.rejected).toEqual([unknownOp]);
    expect(result.applied).toEqual([knownOp]);
    expect(store.getState().nodes.h1?.properties.text).toBe('X');
  });

  it('a remote remove of the locally selected block clears the selection', () => {
    const { store } = makeStore();
    store.select('h1');
    store.applyRemote([{ op: 'remove', id: 'h1' }]);
    expect(store.getState().selection.local?.selected).toBeNull();
  });

  it('ops captured from one store apply cleanly to another store on the same tree (also for undo ops)', () => {
    const { store: storeA, callbacks: callbacksA } = makeStore();
    const { store: storeB } = makeStore();
    let lastOps: readonly EditorOp[] = [];
    callbacksA.onChange = (change) => {
      lastOps = change.ops;
    };

    storeA.add('heading', { parentId: 'root_1' });
    storeB.applyRemote(lastOps);
    expect(storeB.getTree()).toEqual(storeA.getTree());

    storeA.undo();
    storeB.applyRemote(lastOps);
    expect(storeB.getTree()).toEqual(storeA.getTree());
  });
});

describe('selection per user', () => {
  it('select/hover/focus/setEditing write selection.local', () => {
    const { store } = makeStore();
    store.select('h1');
    store.hover('sec1');
    store.focus({ blockId: 'h1', key: 'text' });
    store.setEditing({ blockId: 'h1', key: 'text' });
    expect(store.getState().selection.local).toEqual({
      selected: 'h1',
      hovered: 'sec1',
      focus: { blockId: 'h1', key: 'text' },
      editing: { blockId: 'h1', key: 'text' },
    });
  });

  it("setUserSelection('u2', ...) creates that user", () => {
    const { store } = makeStore();
    store.setUserSelection('u2', { selected: 'h1' });
    expect(store.getState().selection.u2?.selected).toBe('h1');
  });

  it("remove('h1') prunes u2's selection too", () => {
    const { store } = makeStore();
    store.setUserSelection('u2', { selected: 'h1' });
    store.remove('h1');
    expect(store.getState().selection.u2?.selected).toBeNull();
  });

  it('a subscriber is notified on selection changes', () => {
    const { store } = makeStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.select('h1');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('selection changes do NOT bump version and do NOT call onChange', () => {
    const { store, callbacks } = makeStore();
    const onChange = vi.fn();
    callbacks.onChange = onChange;
    store.select('h1');
    store.hover('sec1');
    expect(store.getState().version).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('load', () => {
  it('replaces the tree, resets history/selection, is clean, notifies, does not call onChange', () => {
    const { store, callbacks } = makeStore();
    store.add('heading', { parentId: 'root_1' });
    store.setUserSelection('u2', { selected: 'h1' });
    const onChange = vi.fn();
    callbacks.onChange = onChange;
    const listener = vi.fn();
    store.subscribe(listener);
    const newTree = makeTree();

    store.load(newTree);

    expect(store.getTree()).toEqual(newTree);
    expect(store.getState().history).toEqual({ past: [], future: [] });
    expect(store.getState().selection.local).toEqual({
      selected: null,
      hovered: null,
      focus: null,
      editing: null,
    });
    expect(store.getState().selection.u2).toEqual({
      selected: null,
      hovered: null,
      focus: null,
      editing: null,
    });
    expect(store.isDirty()).toBe(false);
    expect(store.getState().savedVersion).toBe(store.getState().version);
    expect(listener).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the new tree's undeclared root keys survive", () => {
    const { store } = makeStore();
    const newTree: BlockTreeNode = {
      blockId: 'other_root',
      type: 'root',
      properties: { title: 'Other', __lang: 'de' },
      children: [],
    };
    store.load(newTree);
    expect(store.getTree().properties.__lang).toBe('de');
  });
});

describe('markSaved / save', () => {
  it('markSaved after an edit marks clean with savedVersion === version', () => {
    const { store } = makeStore();
    store.update('h1', { text: 'Changed' });
    store.markSaved();
    expect(store.isDirty()).toBe(false);
    expect(store.getState().savedVersion).toBe(store.getState().version);
  });

  it('save() when clean does not call onSave', async () => {
    const { store, callbacks } = makeStore();
    const onSave = vi.fn();
    callbacks.onSave = onSave;
    await store.save();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('save({ message }) when dirty calls onSave once, tracks saving, then goes clean', async () => {
    const { store, callbacks } = makeStore();
    store.update('h1', { text: 'Changed' });
    let sawSavingDuringCall = false;
    const onSave = vi.fn(
      async (tree: BlockTreeNode, meta: { message?: string }) => {
        sawSavingDuringCall = store.getState().saving;
        expect(meta).toEqual({ message: 'm' });
        expect(tree).toEqual(store.getTree());
      },
    );
    callbacks.onSave = onSave;

    await store.save({ message: 'm' });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(sawSavingDuringCall).toBe(true);
    expect(store.getState().saving).toBe(false);
    expect(store.isDirty()).toBe(false);
  });

  it('a rejecting onSave resets saving and leaves the store dirty', async () => {
    const { store, callbacks } = makeStore();
    store.update('h1', { text: 'Changed' });
    callbacks.onSave = vi.fn(async () => {
      throw new Error('boom');
    });

    await expect(store.save()).rejects.toThrow();

    expect(store.getState().saving).toBe(false);
    expect(store.isDirty()).toBe(true);
  });

  it('without onSave, save() is a no-op', async () => {
    const { store } = makeStore();
    store.update('h1', { text: 'Changed' });
    await expect(store.save()).resolves.toBeUndefined();
    expect(store.isDirty()).toBe(true);
  });
});

describe('subscribe', () => {
  it('unsubscribing stops notifications', () => {
    const { store } = makeStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.select('h1');
    unsubscribe();
    store.select('sec1');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('getState() returns a new object after a change and the same object between changes', () => {
    const { store } = makeStore();
    const before = store.getState();
    expect(store.getState()).toBe(before);
    store.select('h1');
    expect(store.getState()).not.toBe(before);
  });
});

describe('createBlockId', () => {
  it('matches blk_ + 20 lowercase alphanumeric characters', () => {
    expect(createBlockId()).toMatch(/^blk_[0-9a-z]{20}$/);
  });

  it('generates 200 unique ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createBlockId()));
    expect(ids.size).toBe(200);
  });
});

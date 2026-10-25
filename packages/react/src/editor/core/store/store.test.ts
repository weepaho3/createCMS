import { describe, expect, it, vi } from 'vitest';

import type { EditorDocument, Op } from '../document';
import type { CreateEditorStoreOptions, EditorChange } from './types';

import { defineEditorSchema } from '../schema';
import { counterGenId, fakeClock, makeDoc, storeSchema } from './fixtures';
import { createBlockId } from './id';
import { createEditorStore } from './store';

function makeStore(overrides: Partial<CreateEditorStoreOptions> = {}) {
  const clock = fakeClock();
  const callbacks: { onChange?: (change: EditorChange) => void } = {};
  const store = createEditorStore({
    schema: storeSchema,
    initialValue: makeDoc(),
    genId: counterGenId(),
    now: clock.now,
    ...overrides,
  });
  store.on('change', (change) => callbacks.onChange?.(change));
  return { store, clock, callbacks };
}

describe('initial state', () => {
  it('starts from the initial tree with clean history', () => {
    const { store } = makeStore();
    const state = store.getDoc();
    expect(state.rootId).toBe('root_1');
    expect(Object.keys(state.nodes)).toHaveLength(4);
    expect(store.isDirty()).toBe(false);
    expect(store.getDocument()).toEqual(makeDoc());
    expect(state.version).toBe(0);
    expect(store.getSession()).toMatchObject({
      selection: [],
      focusedField: null,
      editing: null,
      mode: 'visual',
      history: { canUndo: false, canRedo: false },
      save: { status: 'idle', dirty: false },
    });
    expect(store.getEphemeral()).toEqual({ hoverId: null });
  });
});

describe('add', () => {
  it('appends the new block at the end of root, selects it, marks dirty', () => {
    const { store } = makeStore();
    const id = store.add('heading', { parent: { id: 'root_1' } });
    expect(id).toBe('n1');
    expect(store.getDoc().nodes.root_1?.slots.children).toEqual([
      'h1',
      'sec1',
      'n1',
    ]);
    expect(store.getSession().selection[0] ?? null).toBe('n1');
    expect(store.isDirty()).toBe(true);
    expect(store.getDoc().version).toBe(1);
    expect(store.docStore.getHistory().past).toHaveLength(1);
    expect(store.docStore.getHistory().future).toHaveLength(0);
  });

  it('inserts at an explicit index', () => {
    const { store } = makeStore();
    store.add('heading', { parent: { id: 'root_1' }, index: 0 });
    expect(store.getDoc().nodes.root_1?.slots.children).toEqual([
      'n1',
      'h1',
      'sec1',
    ]);
  });

  it('seeds declared defaults; caller-supplied properties win', () => {
    const { store } = makeStore();
    const id1 = store.add('heading', { parent: { id: 'root_1' } });
    expect(store.getDoc().nodes[id1 ?? '']?.props).toEqual({ level: 2 });
    const id2 = store.add('heading', {
      parent: { id: 'root_1' },
      props: { level: 5 },
    });
    expect(store.getDoc().nodes[id2 ?? '']?.props).toEqual({ level: 5 });
  });

  it('seeds only declared defaults for image (alt), never url', () => {
    const { store } = makeStore();
    const id = store.add('image', { parent: { id: 'root_1' } });
    expect(store.getDoc().nodes[id ?? '']?.props).toEqual({ alt: '' });
  });

  it('drops undefined caller properties', () => {
    const { store } = makeStore();
    const id = store.add('heading', {
      parent: { id: 'root_1' },
      props: { text: undefined, level: 3 },
    });
    expect(store.getDoc().nodes[id ?? '']?.props).toEqual({ level: 3 });
  });

  it('rejects an unknown parent and changes nothing', () => {
    const { store } = makeStore();
    const result = store.add('heading', { parent: { id: 'ghost' } });
    expect(result).toBeNull();
    expect(store.getDoc().version).toBe(0);
    expect(Object.keys(store.getDoc().nodes)).toHaveLength(4);
  });

  it('respects the section whitelist: image rejected, heading allowed', () => {
    const { store } = makeStore();
    expect(store.add('image', { parent: { id: 'sec1' } })).toBeNull();
    const id = store.add('heading', { parent: { id: 'sec1' } });
    expect(id).not.toBeNull();
    expect(store.getDoc().nodes.sec1?.slots.children).toContain(id);
  });

  it('rejects placement into a non-container leaf', () => {
    const { store } = makeStore();
    expect(store.add('heading', { parent: { id: 'h1' } })).toBeNull();
  });

  it('calls onChange once with the add op, version and getDocument', () => {
    const { store, callbacks } = makeStore();
    const onChange = vi.fn();
    callbacks.onChange = onChange;
    store.add('heading', { parent: { id: 'root_1' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const change = onChange.mock.calls[0]?.[0];
    expect(change.ops[0].op).toBe('insert');
    expect(change.version).toBe(1);
    expect(change.getDocument()).toEqual(store.getDocument());
  });
});

describe('update', () => {
  it('merges values and deletes null keys', () => {
    const { store } = makeStore();
    store.update('h1', { text: 'Changed', level: null });
    expect(store.getDoc().nodes.h1?.props).toEqual({ text: 'Changed' });
  });

  it('normalises undefined to null before emitting the op', () => {
    const { store, callbacks } = makeStore();
    const onChange = vi.fn();
    callbacks.onChange = onChange;
    store.update('h1', { level: undefined });
    expect(store.getDoc().nodes.h1?.props).toEqual({ text: 'Hello' });
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
    expect(store.getDocument().root.props).toEqual({
      title: 'New Home',
      __slug: 'home',
    });
  });

  it('stays dirty after changing a value back by hand (unsaved edits, not a diff)', () => {
    const { store } = makeStore();
    store.update('h1', { text: 'Changed' });
    store.update('h1', { text: 'Hello' });
    expect(store.isDirty()).toBe(true);
  });

  it('never serialises a null property after a delete', () => {
    const { store } = makeStore();
    store.update('h1', { level: null });
    const doc = store.getDocument();
    const heading = doc.root.slots?.children?.find((c) => c.id === 'h1');
    expect(Object.values(heading?.props ?? {})).not.toContain(null);
  });
});

describe('move', () => {
  it('reparents a block', () => {
    const { store } = makeStore();
    expect(store.move('h1', { parent: { id: 'sec1' }, index: 0 })).toBe(true);
    expect(store.getDoc().nodes.root_1?.slots.children).toEqual(['sec1']);
    expect(store.getDoc().nodes.sec1?.slots.children).toEqual(['h1', 'p1']);
  });

  it('reorders within the same parent', () => {
    const { store } = makeStore();
    store.move('h1', { parent: { id: 'root_1' }, index: 1 });
    expect(store.getDoc().nodes.root_1?.slots.children).toEqual(['sec1', 'h1']);
  });

  it('rejects a cyclical move and changes nothing', () => {
    const { store } = makeStore();
    const before = store.getDoc();
    expect(store.move('sec1', { parent: { id: 'sec1' }, index: 0 })).toBe(
      false,
    );
    expect(store.getDoc()).toBe(before);
  });

  it('rejects moving the root', () => {
    const { store } = makeStore();
    expect(store.move('root_1', { parent: { id: 'sec1' }, index: 0 })).toBe(
      false,
    );
  });

  it('enforces placement on move (an ad-hoc image is rejected by the section whitelist)', () => {
    const { store } = makeStore();
    expect(store.move('h1', { parent: { id: 'sec1' }, index: 0 })).toBe(true);
    const imageId = store.add('image', { parent: { id: 'root_1' } });
    expect(
      store.move(imageId ?? '', { parent: { id: 'sec1' }, index: 0 }),
    ).toBe(false);
  });

  it('rejects an unknown target', () => {
    const { store } = makeStore();
    expect(store.move('h1', { parent: { id: 'ghost' }, index: 0 })).toBe(false);
  });
});

describe('remove', () => {
  it('cascades: removes the block and its subtree', () => {
    const { store } = makeStore();
    store.remove('sec1');
    expect(store.getDoc().nodes.sec1).toBeUndefined();
    expect(store.getDoc().nodes.p1).toBeUndefined();
    expect(store.getDoc().nodes.root_1?.slots.children).toEqual(['h1']);
  });

  it('clears selection fields that pointed into the removed subtree', () => {
    const { store } = makeStore();
    store.select('p1');
    store.hover('sec1');
    store.focus({ blockId: 'p1', key: 'text' });
    store.setEditing({ blockId: 'p1', key: 'text' });
    store.remove('sec1');
    expect(store.getSession()).toMatchObject({
      selection: [],
      focusedField: null,
      editing: null,
    });
    expect(store.getEphemeral().hoverId).toBeNull();
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
    expect(store.getDoc().nodes.root_1?.slots.children).toEqual([
      'h1',
      'n1',
      'sec1',
    ]);
    expect(store.getDoc().nodes.n1?.props).toEqual({
      text: 'Hello',
      level: 1,
    });
    expect(store.getSession().selection[0] ?? null).toBe('n1');
    expect(store.isDirty()).toBe(true);
  });

  it('deep-copies a subtree with fresh ids and rewires the parent links', () => {
    const { store } = makeStore();
    store.duplicate('sec1');
    expect(store.getDoc().nodes.n1?.type).toBe('section');
    expect(store.getDoc().nodes.n2?.type).toBe('paragraph');
    expect(store.getDoc().nodes.n2?.parent?.id).toBe('n1');
  });

  it('the copy is independent of the original', () => {
    const { store } = makeStore();
    const id = store.duplicate('h1');
    store.update(id ?? '', { text: 'Copy text' });
    expect(store.getDoc().nodes.h1?.props.text).toBe('Hello');
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
    expect(change.ops[0].op).toBe('insert');
    expect(change.ops[0].node.id).toBe('n1');
  });
});

describe('undo/redo', () => {
  it('undoes an add back to the original tree', () => {
    const { store } = makeStore();
    store.add('heading', { parent: { id: 'root_1' } });
    expect(store.undo()).toBe(true);
    expect(store.getDocument()).toEqual(makeDoc());
    // An undo is a change the next save carries.
    expect(store.isDirty()).toBe(true);
    expect(store.docStore.getHistory().future).toHaveLength(1);
  });

  it('redoes back to the changed tree', () => {
    const { store } = makeStore();
    store.add('heading', { parent: { id: 'root_1' } });
    store.undo();
    expect(store.redo()).toBe(true);
    expect(store.isDirty()).toBe(true);
  });

  it('undo/redo on empty history is a no-op', () => {
    const { store } = makeStore();
    expect(store.undo()).toBe(false);
    expect(store.redo()).toBe(false);
    expect(store.getDoc().version).toBe(0);
  });

  describe('roundtrip per action', () => {
    it('add', () => {
      const { store } = makeStore();
      store.add('heading', { parent: { id: 'root_1' } });
      const afterAction = store.getDocument();
      store.undo();
      expect(store.getDocument()).toEqual(makeDoc());
      store.redo();
      expect(store.getDocument()).toEqual(afterAction);
    });

    it('update', () => {
      const { store } = makeStore();
      store.update('h1', { text: 'Changed' });
      const afterAction = store.getDocument();
      store.undo();
      expect(store.getDocument()).toEqual(makeDoc());
      store.redo();
      expect(store.getDocument()).toEqual(afterAction);
    });

    it('move (reparent)', () => {
      const { store } = makeStore();
      store.move('h1', { parent: { id: 'sec1' }, index: 0 });
      const afterAction = store.getDocument();
      store.undo();
      expect(store.getDocument()).toEqual(makeDoc());
      store.redo();
      expect(store.getDocument()).toEqual(afterAction);
    });

    it("remove('sec1')", () => {
      const { store } = makeStore();
      store.remove('sec1');
      const afterAction = store.getDocument();
      store.undo();
      expect(store.getDocument()).toEqual(makeDoc());
      store.redo();
      expect(store.getDocument()).toEqual(afterAction);
    });

    it("duplicate('sec1')", () => {
      const { store } = makeStore();
      store.duplicate('sec1');
      const afterAction = store.getDocument();
      store.undo();
      expect(store.getDocument()).toEqual(makeDoc());
      store.redo();
      expect(store.getDocument()).toEqual(afterAction);
    });
  });

  it('undo/redo emit a history change with the inverse/forward ops respectively', () => {
    const { store, callbacks } = makeStore();
    store.add('heading', { parent: { id: 'root_1' } });
    const onChange = vi.fn();
    callbacks.onChange = onChange;
    store.undo();
    expect(onChange.mock.calls[0]?.[0].ops[0].op).toBe('remove');
    expect(onChange.mock.calls[0]?.[0].origin).toBe('history');
    store.redo();
    expect(onChange.mock.calls[1]?.[0].ops[0].op).toBe('insert');
  });

  it('undo of an add clears local.selected when the block disappears', () => {
    const { store } = makeStore();
    store.add('heading', { parent: { id: 'root_1' } });
    expect(store.getSession().selection[0] ?? null).toBe('n1');
    store.undo();
    expect(store.getSession().selection[0] ?? null).toBeNull();
  });
});

describe('coalescing', () => {
  it('collapses five rapid coalesced updates into one entry undone by a single undo()', () => {
    const { store, clock } = makeStore();
    for (const v of ['H', 'He', 'Hel', 'Hell', 'Hallo']) {
      store.update('h1', { text: v }, { coalesce: true });
      clock.advance(50);
    }
    expect(store.docStore.getHistory().past).toHaveLength(1);
    store.undo();
    expect(store.getDoc().nodes.h1?.props.text).toBe('Hello');
  });

  it('the merged entry keeps every op; inverse[0] undoes the LAST update first', () => {
    const { store, clock } = makeStore();
    for (const v of ['H', 'He', 'Hel']) {
      store.update('h1', { text: v }, { coalesce: true });
      clock.advance(50);
    }
    const entry = store.docStore.getHistory().past[0];
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
    expect(store.docStore.getHistory().past).toHaveLength(2);
  });

  it('a non-coalesced update always starts a new entry', () => {
    const { store } = makeStore();
    store.update('h1', { text: 'A' }, { coalesce: true });
    store.update('h1', { text: 'B' });
    expect(store.docStore.getHistory().past).toHaveLength(2);
  });

  it('different coalesce keys start separate entries', () => {
    const { store } = makeStore();
    store.update('h1', { text: 'A' }, { coalesce: true });
    store.update('h1', { level: 3 }, { coalesce: true });
    expect(store.docStore.getHistory().past).toHaveLength(2);
  });

  it('select() breaks the coalescing window', () => {
    const { store } = makeStore();
    store.update('h1', { text: 'A' }, { coalesce: true });
    store.select('p1');
    store.update('h1', { text: 'B' }, { coalesce: true });
    expect(store.docStore.getHistory().past).toHaveLength(2);
  });

  it('focus()/setEditing() break the coalescing window', () => {
    const { store: storeA } = makeStore();
    storeA.update('h1', { text: 'A' }, { coalesce: true });
    storeA.focus({ blockId: 'h1', key: 'text' });
    storeA.update('h1', { text: 'B' }, { coalesce: true });
    expect(storeA.docStore.getHistory().past).toHaveLength(2);

    const { store: storeB } = makeStore();
    storeB.update('h1', { text: 'A' }, { coalesce: true });
    storeB.setEditing({ blockId: 'h1', key: 'text' });
    storeB.update('h1', { text: 'B' }, { coalesce: true });
    expect(storeB.docStore.getHistory().past).toHaveLength(2);
  });

  it('hover() does NOT break the coalescing window', () => {
    const { store } = makeStore();
    store.update('h1', { text: 'A' }, { coalesce: true });
    store.hover('p1');
    store.update('h1', { text: 'B' }, { coalesce: true });
    expect(store.docStore.getHistory().past).toHaveLength(1);
  });

  it('a coalesced update after undo() starts its own new entry', () => {
    const { store } = makeStore();
    store.update('h1', { text: 'A' }, { coalesce: true });
    store.undo();
    store.update('h1', { text: 'B' }, { coalesce: true });
    expect(store.docStore.getHistory().past).toHaveLength(1);
    expect(store.docStore.getHistory().past[0]?.ops).toHaveLength(1);
  });
});

describe('applyRemote', () => {
  it('applies a remote update: bumps version, notifies, no history, not dirty, change with origin remote', () => {
    const { store, callbacks } = makeStore();
    const onChange = vi.fn();
    callbacks.onChange = onChange;
    const listener = vi.fn();
    store.subscribeDoc(listener);
    const result = store.applyRemote([
      { op: 'update', id: 'h1', patch: { text: 'Remote' } },
    ]);
    expect(result.applied).toHaveLength(1);
    expect(store.getDoc().nodes.h1?.props.text).toBe('Remote');
    expect(store.getDoc().version).toBe(1);
    expect(listener).toHaveBeenCalled();
    expect(store.docStore.getHistory().past).toHaveLength(0);
    expect(onChange.mock.calls[0]?.[0].origin).toBe('remote');
    expect(store.isDirty()).toBe(false);
  });

  it('skips a rejected op (unknown id) while the others apply', () => {
    const { store } = makeStore();
    const unknownOp: Op = { op: 'update', id: 'ghost', patch: { a: 1 } };
    const knownOp: Op = { op: 'update', id: 'h1', patch: { text: 'X' } };
    const rejected = vi.fn();
    store.on('opRejected', rejected);
    const result = store.applyRemote([unknownOp, knownOp]);
    expect(result.rejected).toEqual([unknownOp]);
    expect(result.applied).toEqual([knownOp]);
    expect(store.getDoc().nodes.h1?.props.text).toBe('X');
    expect(rejected).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'remote', op: unknownOp }),
    );
  });

  it('a remote remove of the locally selected block clears the selection', () => {
    const { store } = makeStore();
    store.select('h1');
    store.applyRemote([{ op: 'remove', id: 'h1' }]);
    expect(store.getSession().selection).toEqual([]);
  });

  it('ops captured from one store apply cleanly to another store on the same tree (also for undo ops)', () => {
    const { store: storeA, callbacks: callbacksA } = makeStore();
    const { store: storeB } = makeStore();
    let lastOps: readonly Op[] = [];
    callbacksA.onChange = (change) => {
      lastOps = change.ops;
    };

    storeA.add('heading', { parent: { id: 'root_1' } });
    storeB.applyRemote(lastOps);
    expect(storeB.getDocument()).toEqual(storeA.getDocument());

    storeA.undo();
    storeB.applyRemote(lastOps);
    expect(storeB.getDocument()).toEqual(storeA.getDocument());
  });

  it('accept-and-warn applies a misplaced remote op with a diagnostic', () => {
    const { store } = makeStore();
    const diagnostic = vi.fn();
    store.on('diagnostic', diagnostic);
    const op: Op = {
      op: 'insert',
      parent: { id: 'sec1', slot: 'children' },
      index: 0,
      node: { id: 'img', type: 'image', props: {} },
    };
    expect(store.applyRemote([op]).applied).toEqual([op]);
    expect(diagnostic).toHaveBeenCalledWith({
      kind: 'placement',
      op,
      code: 'not-allowed',
    });
  });

  it('reject refuses a misplaced remote op', () => {
    const { store } = makeStore({ remotePlacement: 'reject' });
    const op: Op = {
      op: 'insert',
      parent: { id: 'sec1', slot: 'children' },
      index: 0,
      node: { id: 'img', type: 'image', props: {} },
    };
    expect(store.applyRemote([op]).rejected).toEqual([op]);
    expect(store.getDoc().nodes.img).toBeUndefined();
  });

  it('drops local undo steps a remote change touches, keeps the others', () => {
    const { store } = makeStore();
    const invalidated = vi.fn();
    store.on('historyInvalidated', invalidated);
    store.update('h1', { text: 'Mine' });
    store.update('p1', { text: 'Mine too' });
    store.applyRemote([{ op: 'update', id: 'h1', patch: { text: 'Theirs' } }]);
    expect(invalidated).toHaveBeenCalledWith({ count: 1 });
    expect(store.docStore.getHistory().past).toHaveLength(1);
    expect(store.undo()).toBe(true);
    expect(store.getDoc().nodes.p1?.props.text).toBe('World');
    expect(store.getDoc().nodes.h1?.props.text).toBe('Theirs');
    expect(store.undo()).toBe(false);
  });

  it('keeps an undo step when the remote change writes another prop of the same node', () => {
    const { store } = makeStore();
    store.update('h1', { text: 'Mine' });
    store.applyRemote([{ op: 'update', id: 'h1', patch: { level: 4 } }]);
    expect(store.undo()).toBe(true);
    expect(store.getDoc().nodes.h1?.props).toEqual({ text: 'Hello', level: 4 });
  });

  it('a remote remove drops undo steps that wrote props of the removed node', () => {
    const { store } = makeStore();
    store.update('p1', { text: 'Mine' });
    store.applyRemote([{ op: 'remove', id: 'sec1' }]);
    expect(store.getSession().history.canUndo).toBe(false);
  });
});

describe('session and ephemeral scopes', () => {
  it('select/focus/setEditing write the session, hover the ephemeral scope', () => {
    const { store } = makeStore();
    store.select('h1');
    store.hover('sec1');
    store.focus({ blockId: 'h1', key: 'text' });
    store.setEditing({ blockId: 'h1', key: 'text' });
    expect(store.getSession()).toMatchObject({
      selection: ['h1'],
      focusedField: { blockId: 'h1', key: 'text' },
      editing: { blockId: 'h1', key: 'text' },
    });
    expect(store.getEphemeral().hoverId).toBe('sec1');
  });

  it('hover wakes neither document nor session listeners', () => {
    const { store } = makeStore();
    const docListener = vi.fn();
    const sessionListener = vi.fn();
    const hoverListener = vi.fn();
    store.subscribeDoc(docListener);
    store.subscribeSession(sessionListener);
    store.subscribeEphemeral(hoverListener);
    store.hover('h1');
    store.hover('sec1');
    expect(hoverListener).toHaveBeenCalledTimes(2);
    expect(docListener).not.toHaveBeenCalled();
    expect(sessionListener).not.toHaveBeenCalled();
  });

  it('a selection change does not wake document listeners or bump the version', () => {
    const { store, callbacks } = makeStore();
    const onChange = vi.fn();
    callbacks.onChange = onChange;
    const docListener = vi.fn();
    store.subscribeDoc(docListener);
    store.select('h1');
    expect(docListener).not.toHaveBeenCalled();
    expect(store.getDoc().version).toBe(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the same selection keeps its reference and does not notify', () => {
    const { store } = makeStore();
    store.select('h1');
    const before = store.getSession();
    const listener = vi.fn();
    store.subscribeSession(listener);
    store.select('h1');
    store.setSelection(['h1']);
    expect(listener).not.toHaveBeenCalled();
    expect(store.getSession()).toBe(before);
  });

  it('setSelection keeps several ids, the first is primary; unknown ids are dropped', () => {
    const { store } = makeStore();
    store.setSelection(['sec1', 'ghost', 'h1']);
    expect(store.getSession().selection).toEqual(['sec1', 'h1']);
  });

  it('a document change does not wake session listeners when nothing session-side changed', () => {
    const { store } = makeStore();
    const listener = vi.fn();
    store.subscribeSession(listener);
    store.update('h1', { text: 'x' });
    // canUndo flips once: the first edit.
    expect(listener).toHaveBeenCalledTimes(2);
    store.update('h1', { text: 'y' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('setMode writes the session', () => {
    const { store } = makeStore();
    store.setMode('form');
    expect(store.getSession().mode).toBe('form');
  });
});

describe('load', () => {
  it('replaces the tree, resets history and selection, is clean, emits a system change', () => {
    const { store, callbacks } = makeStore();
    store.add('heading', { parent: { id: 'root_1' } });
    const onChange = vi.fn();
    callbacks.onChange = onChange;
    const listener = vi.fn();
    store.subscribeDoc(listener);
    const newTree = makeDoc();

    store.load(newTree);

    expect(store.getDocument()).toEqual(newTree);
    expect(store.docStore.getHistory()).toEqual({ past: [], future: [] });
    expect(store.getSession()).toMatchObject({
      selection: [],
      focusedField: null,
      editing: null,
      history: { canUndo: false, canRedo: false },
    });
    expect(store.isDirty()).toBe(false);
    expect(listener).toHaveBeenCalled();
    expect(onChange.mock.calls[0]?.[0].origin).toBe('system');
  });

  it("the new tree's undeclared root keys survive", () => {
    const { store } = makeStore();
    const newDoc: EditorDocument = {
      schemaVersion: 1,
      root: {
        id: 'other_root',
        type: 'root',
        props: { title: 'Other', __lang: 'de' },
      },
    };
    store.load(newDoc);
    expect(store.getDocument().root.props.__lang).toBe('de');
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

describe('named slots', () => {
  const slotSchema = defineEditorSchema({
    root: { label: 'Root', fields: {}, slots: { children: {} } },
    components: {
      columns: {
        label: 'Columns',
        fields: {},
        slots: {
          left: {
            allow: ['text'],
            defaultValue: [{ type: 'text', props: { body: 'Left' } }],
          },
          right: { max: 1 },
        },
      },
      text: {
        label: 'Text',
        fields: { body: { type: 'text' }, jump: { type: 'link' } },
      },
    },
  });

  function slotStore() {
    return createEditorStore({
      schema: slotSchema,
      initialValue: {
        schemaVersion: 1,
        root: { id: 'r', type: 'root', props: {}, slots: { children: [] } },
      },
      genId: counterGenId(),
    });
  }

  it('seeds slot defaults with fresh ids on add', () => {
    const store = slotStore();
    const id = store.add('columns', { parent: { id: 'r' } });
    expect(id).toBe('n1');
    const { nodes } = store.getDoc();
    expect(nodes.n1?.slots.left).toEqual(['n2']);
    expect(nodes.n2).toMatchObject({
      type: 'text',
      props: { body: 'Left' },
      parent: { id: 'n1', slot: 'left' },
    });
  });

  it('adds into a named slot and rejects what the slot refuses', () => {
    const store = slotStore();
    store.add('columns', { parent: { id: 'r' } });
    expect(
      store.add('columns', { parent: { id: 'n1', slot: 'left' } }),
    ).toBeNull();
    const id = store.add('text', { parent: { id: 'n1', slot: 'right' } });
    expect(store.getDoc().nodes.n1?.slots.right).toEqual([id]);
    expect(
      store.add('text', { parent: { id: 'n1', slot: 'right' } }),
    ).toBeNull();
    expect(
      store.add('text', { parent: { id: 'n1', slot: 'nope' } }),
    ).toBeNull();
  });

  it('moves across slots, undo restores the old slot', () => {
    const store = slotStore();
    store.add('columns', { parent: { id: 'r' } });
    const before = store.getDocument();
    expect(
      store.move('n2', { parent: { id: 'n1', slot: 'right' }, index: 0 }),
    ).toBe(true);
    expect(store.getDoc().nodes.n2?.parent).toEqual({
      id: 'n1',
      slot: 'right',
    });
    store.undo();
    expect(store.getDocument()).toEqual(before);
  });

  it('refuses a duplicate into a full slot', () => {
    const store = slotStore();
    store.add('columns', { parent: { id: 'r' } });
    const id = store.add('text', { parent: { id: 'n1', slot: 'right' } });
    expect(store.duplicate(id ?? '')).toBeNull();
  });

  it('duplicates a subtree with every slot and rewrites anchors to the copy', () => {
    const store = slotStore();
    store.add('columns', { parent: { id: 'r' } });
    store.update('n2', {
      jump: {
        kind: 'internal',
        rootId: 'p',
        collection: 'pages',
        fragment: 'n2',
      },
    });
    const copy = store.duplicate('n1');
    const { nodes } = store.getDoc();
    const [copied] = nodes[copy ?? '']?.slots.left ?? [];
    expect(copied).toBeDefined();
    expect(copied).not.toBe('n2');
    expect(nodes[copied ?? '']?.props.jump).toMatchObject({ fragment: copied });
    expect(nodes.r?.slots.children).toEqual(['n1', copy]);
  });

  it('getDocument writes declared slots in declaration order', () => {
    const store = slotStore();
    store.add('columns', { parent: { id: 'r' } });
    store.add('text', { parent: { id: 'n1', slot: 'right' } });
    const cols = store.getDocument().root.slots?.children?.[0];
    expect(Object.keys(cols?.slots ?? {})).toEqual(['left', 'right']);
  });
});

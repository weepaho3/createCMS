import { describe, expect, it, vi } from 'vitest';

import { createJsonDocStore, MERGE_MS, TxRejectedError } from './doc-store';
import { fakeClock, makeDoc } from './fixtures';

function makeDocStore(options: { maxEntries?: number } = {}) {
  const clock = fakeClock();
  const store = createJsonDocStore({
    initialValue: makeDoc(),
    now: clock.now,
    ...options,
  });
  return { store, clock };
}

const setText = (text: string) => ({
  op: 'update' as const,
  id: 'h1',
  patch: { text },
});

describe('transact', () => {
  it('applies all writes or none and reports changes once', () => {
    const { store } = makeDocStore();
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSnapshot();
    expect(() =>
      store.transact((tx) => {
        tx.apply(setText('A'));
        tx.removeNode('ghost');
      }),
    ).toThrow(TxRejectedError);
    expect(store.getSnapshot()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
    store.transact((tx) => {
      tx.apply(setText('A'));
      tx.moveNode('h1', 'sec1', 'children', 0);
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[1]).toBe('local');
  });

  it('a throwing callback leaves the state unchanged', () => {
    const { store } = makeDocStore();
    const before = store.getSnapshot();
    expect(() =>
      store.transact((tx) => {
        tx.apply(setText('A'));
        throw new Error('nope');
      }),
    ).toThrow(TxRejectedError);
    expect(store.getSnapshot()).toBe(before);
  });

  it('setProp writes nested paths and reads earlier writes of the transaction', () => {
    const { store } = makeDocStore();
    store.transact((tx) => {
      tx.setProp('h1', ['meta', 'a'], 1);
      tx.setProp('h1', ['meta', 'b'], 2);
      tx.setProp('h1', ['level'], undefined);
    });
    expect(store.getSnapshot().nodes.h1?.props).toEqual({
      text: 'Hello',
      meta: { a: 1, b: 2 },
    });
  });

  it('remote writes are never recorded', () => {
    const { store } = makeDocStore();
    store.transact((tx) => tx.apply(setText('A')), { origin: 'remote' });
    expect(store.canUndo()).toBe(false);
  });
});

describe('history', () => {
  it(`merges steps with the same key within ${MERGE_MS} ms, sliding`, () => {
    const { store, clock } = makeDocStore();
    store.transact((tx) => tx.apply(setText('A')), { mergeKey: 'k' });
    clock.advance(MERGE_MS - 1);
    store.transact((tx) => tx.apply(setText('AB')), { mergeKey: 'k' });
    clock.advance(MERGE_MS - 1);
    store.transact((tx) => tx.apply(setText('ABC')), { mergeKey: 'k' });
    expect(store.getHistory().past).toHaveLength(1);
    clock.advance(MERGE_MS + 1);
    store.transact((tx) => tx.apply(setText('ABCD')), { mergeKey: 'k' });
    expect(store.getHistory().past).toHaveLength(2);
    store.undo();
    store.undo();
    expect(store.getSnapshot().nodes.h1?.props.text).toBe('Hello');
  });

  it('another key, breakMerge or an unkeyed step ends the merge', () => {
    const { store } = makeDocStore();
    store.transact((tx) => tx.apply(setText('A')), { mergeKey: 'k' });
    store.breakMerge();
    store.transact((tx) => tx.apply(setText('B')), { mergeKey: 'k' });
    store.transact((tx) => tx.apply(setText('C')), { mergeKey: 'other' });
    store.transact((tx) => tx.apply(setText('D')));
    store.transact((tx) => tx.apply(setText('E')), { mergeKey: 'other' });
    expect(store.getHistory().past).toHaveLength(5);
  });

  it('undo returns the selection before, redo the selection after, and the label', () => {
    const { store } = makeDocStore();
    store.transact((tx) => tx.moveNode('h1', 'sec1', 'children', 0), {
      label: 'Move block',
      selection: { before: ['h1'], after: ['sec1'] },
    });
    expect(store.undo()).toMatchObject({
      selection: ['h1'],
      label: 'Move block',
    });
    expect(store.redo()).toMatchObject({
      selection: ['sec1'],
      label: 'Move block',
    });
  });

  it('caps the history; the oldest entry goes first', () => {
    const { store } = makeDocStore({ maxEntries: 3 });
    for (const text of ['1', '2', '3', '4']) {
      store.transact((tx) => tx.apply(setText(text)));
    }
    expect(store.getHistory().past).toHaveLength(3);
    while (store.undo()) {
      // undo everything that is left
    }
    expect(store.getSnapshot().nodes.h1?.props.text).toBe('1');
  });

  it('keeps 200 entries by default', () => {
    const { store } = makeDocStore();
    for (let i = 0; i < 201; i++) {
      store.transact((tx) => tx.apply(setText(String(i))));
    }
    expect(store.getHistory().past).toHaveLength(200);
    expect(store.getHistory().past[0]?.ops[0]).toEqual(setText('1'));
  });

  it('a new step clears the redo stack', () => {
    const { store } = makeDocStore();
    store.transact((tx) => tx.apply(setText('A')));
    store.undo();
    expect(store.canRedo()).toBe(true);
    store.transact((tx) => tx.apply(setText('B')));
    expect(store.canRedo()).toBe(false);
  });
});

describe('marks', () => {
  it('squash turns live writes and recorded steps since the mark into one step', () => {
    const { store } = makeDocStore();
    store.transact((tx) => tx.apply(setText('before')));
    const mark = store.mark();
    store.transact((tx) => tx.apply(setText('live 1')), { history: 'ignore' });
    store.transact((tx) => tx.apply(setText('live 2')), { history: 'ignore' });
    store.transact((tx) =>
      tx.apply({ op: 'update', id: 'p1', patch: { text: 'x' } }),
    );
    store.squash(mark, { label: 'Resize' });
    expect(store.getHistory().past).toHaveLength(2);
    expect(store.getHistory().past[1]?.label).toBe('Resize');
    store.undo();
    expect(store.getSnapshot().nodes.h1?.props.text).toBe('before');
    expect(store.getSnapshot().nodes.p1?.props.text).toBe('World');
  });

  it('bail reverts everything since the mark without a history entry', () => {
    const { store } = makeDocStore();
    store.transact((tx) => tx.apply(setText('kept')));
    const mark = store.mark();
    store.transact((tx) => tx.apply(setText('live')), { history: 'ignore' });
    store.transact((tx) => tx.removeNode('sec1'));
    const reverted = store.bail(mark);
    expect(reverted.length).toBeGreaterThan(0);
    expect(store.getSnapshot().nodes.h1?.props.text).toBe('kept');
    expect(store.getSnapshot().nodes.sec1).toBeDefined();
    expect(store.getHistory().past).toHaveLength(1);
  });

  it('bailing an inner mark keeps the outer mark consistent', () => {
    const { store } = makeDocStore();
    const outer = store.mark();
    store.transact((tx) => tx.apply(setText('outer')));
    const inner = store.mark();
    store.transact((tx) => tx.apply(setText('inner')));
    store.bail(inner);
    expect(store.getSnapshot().nodes.h1?.props.text).toBe('outer');
    store.bail(outer);
    expect(store.getSnapshot().nodes.h1?.props.text).toBe('Hello');
  });
});

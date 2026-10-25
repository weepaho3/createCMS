import { describe, expect, it, vi } from 'vitest';

import type { Command, Middleware } from './types';

import { counterGenId, makeDoc, storeSchema } from './fixtures';
import { createEditorStore } from './store';

function makeStore() {
  return createEditorStore({
    schema: storeSchema,
    initialValue: makeDoc(),
    genId: counterGenId(),
  });
}

const rename = (text: string): Command => ({
  type: 'node.update',
  payload: { id: 'h1', patch: { text } },
});

describe('dispatch', () => {
  it('runs middlewares by descending priority, then the handler', () => {
    const store = makeStore();
    const order: string[] = [];
    const tag =
      (name: string): Middleware =>
      (ctx, next) => {
        order.push(`${name}:in`);
        const ops = next(ctx.cmd);
        order.push(`${name}:out`);
        return ops;
      };
    store.use(tag('low'), { priority: -1 });
    store.use(tag('high'), { priority: 10 });
    store.use(tag('mid'));
    expect(store.dispatch(rename('A')).ok).toBe(true);
    expect(order).toEqual([
      'high:in',
      'mid:in',
      'low:in',
      'low:out',
      'mid:out',
      'high:out',
    ]);
  });

  it('a middleware can transform the command', () => {
    const store = makeStore();
    store.use((ctx, next) =>
      next({ ...ctx.cmd, payload: { id: 'h1', patch: { text: 'shouted' } } }),
    );
    store.dispatch(rename('quiet'));
    expect(store.getDoc().nodes.h1?.props.text).toBe('shouted');
  });

  it('a throwing command leaves every scope unchanged and reports the error', () => {
    const store = makeStore();
    store.select('h1');
    const doc = store.getDoc();
    const session = store.getSession();
    const onError = vi.fn();
    store.on('error', onError);
    store.use(() => {
      throw new Error('denied');
    });
    const result = store.dispatch(rename('A'));
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'command', message: 'denied' },
    });
    expect(store.getDoc()).toBe(doc);
    expect(store.getSession()).toBe(session);
    expect(store.docStore.canUndo()).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('beforeCommand can cancel a command and opRejected fires', () => {
    const store = makeStore();
    const rejected = vi.fn();
    store.on('opRejected', rejected);
    const off = store.onBeforeCommand((cmd) =>
      cmd.type === 'node.remove' ? false : undefined,
    );
    expect(store.remove('h1')).toBe(false);
    expect(rejected).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ kind: 'cancelled' }),
      }),
    );
    off();
    expect(store.remove('h1')).toBe(true);
  });

  it('beforeCommand can replace a command', () => {
    const store = makeStore();
    store.onBeforeCommand((cmd) =>
      cmd.type === 'node.update' ? rename('replaced') : undefined,
    );
    store.update('h1', { text: 'mine' });
    expect(store.getDoc().nodes.h1?.props.text).toBe('replaced');
  });

  it('an unknown command type is an error', () => {
    const store = makeStore();
    expect(store.dispatch({ type: 'nope', payload: null })).toMatchObject({
      ok: false,
      error: { kind: 'unknown-command' },
    });
  });

  it('the placement middleware refuses a local insert with its code', () => {
    const store = makeStore();
    const result = store.dispatch({
      type: 'node.insert',
      payload: { type: 'image', parent: { id: 'sec1' } },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'placement', code: 'not-allowed' },
    });
  });

  it('custom handlers turn commands into ops and afterCommand fires', () => {
    const store = makeStore();
    const after = vi.fn();
    store.on('afterCommand', after);
    store.handle<{ text: string }>('heading.shout', ({ text }) => [
      { op: 'update', id: 'h1', patch: { text: text.toUpperCase() } },
    ]);
    store.dispatch({ type: 'heading.shout', payload: { text: 'hi' } });
    expect(store.getDoc().nodes.h1?.props.text).toBe('HI');
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('history: ignore applies without an undo step', () => {
    const store = makeStore();
    store.dispatch({ ...rename('live'), meta: { history: 'ignore' } });
    expect(store.getDoc().nodes.h1?.props.text).toBe('live');
    expect(store.getSession().history.canUndo).toBe(false);
  });
});

describe('transact', () => {
  it('groups every command into one labelled undo step', () => {
    const store = makeStore();
    const result = store.transact(
      () => {
        store.update('h1', { text: 'A' });
        store.add('heading', { parent: { id: 'root_1' } });
        store.remove('p1');
      },
      { label: 'Rebuild' },
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.ops).toHaveLength(3);
    const past = store.docStore.getHistory().past;
    expect(past).toHaveLength(1);
    expect(past[0]?.label).toBe('Rebuild');
    store.undo();
    expect(store.getDocument()).toEqual(makeDoc());
  });

  it('a throw reverts every command of the group', () => {
    const store = makeStore();
    const result = store.transact(() => {
      store.update('h1', { text: 'A' });
      throw new Error('stop');
    });
    expect(result.ok).toBe(false);
    expect(store.getDocument()).toEqual(makeDoc());
    expect(store.getSession().history.canUndo).toBe(false);
  });
});

describe('selection restore', () => {
  it('undo after a move restores position and selection, redo the selection after', () => {
    const store = makeStore();
    store.select('h1');
    store.move('h1', { parent: { id: 'sec1' }, index: 0 });
    store.select('p1');
    store.undo();
    expect(store.getDoc().nodes.h1?.parent).toEqual({
      id: 'root_1',
      slot: 'children',
    });
    expect(store.getSession().selection).toEqual(['h1']);
    store.redo();
    expect(store.getSession().selection).toEqual(['h1']);
  });

  it('undo of an insert restores the selection before it', () => {
    const store = makeStore();
    store.select('sec1');
    store.add('heading', { parent: { id: 'root_1' } });
    expect(store.getSession().selection).toEqual(['n1']);
    store.undo();
    expect(store.getSession().selection).toEqual(['sec1']);
    store.redo();
    expect(store.getSession().selection).toEqual(['n1']);
  });
});

describe('typing merges', () => {
  it('one typing run is one undo step; a field change starts another', () => {
    let now = 0;
    const store = createEditorStore({
      schema: storeSchema,
      initialValue: makeDoc(),
      now: () => now,
    });
    for (const text of ['H', 'He', 'Hey']) {
      store.update('h1', { text }, { coalesce: true });
      now += 100;
    }
    store.update('h1', { level: 3 }, { coalesce: true });
    expect(store.docStore.getHistory().past).toHaveLength(2);
    store.undo();
    store.undo();
    expect(store.getDocument()).toEqual(makeDoc());
  });

  it('a selection change breaks the merge', () => {
    const store = makeStore();
    store.update('h1', { text: 'A' }, { coalesce: true });
    store.select('p1');
    store.update('h1', { text: 'AB' }, { coalesce: true });
    expect(store.docStore.getHistory().past).toHaveLength(2);
  });
});

describe('wrap', () => {
  it('wraps a node in a new container at its position, one undo step', () => {
    const store = makeStore();
    const id = store.wrap('h1', 'section');
    expect(id).toBe('n1');
    expect(store.getDoc().nodes.root_1?.slots.children).toEqual(['n1', 'sec1']);
    expect(store.getDoc().nodes.n1?.slots.children).toEqual(['h1']);
    store.undo();
    expect(store.getDocument()).toEqual(makeDoc());
  });

  it('is refused when the wrapper does not accept the node', () => {
    const store = makeStore();
    store.add('image', { parent: { id: 'root_1' } });
    expect(store.wrap('n1', 'section')).toBeNull();
  });
});

describe('commands', () => {
  it('runs built-in UI commands with availability', () => {
    const store = makeStore();
    expect(store.commands.canExecute('history.undo')).toBe(false);
    store.update('h1', { text: 'A' });
    expect(store.commands.canExecute('history.undo')).toBe(true);
    store.commands.execute('history.undo');
    expect(store.getDocument()).toEqual(makeDoc());
    store.select('h1');
    store.commands.execute('block.duplicate');
    expect(store.getDoc().nodes.root_1?.slots.children).toHaveLength(3);
  });

  it('binds undo and redo by default', () => {
    expect(makeStore().commands.shortcuts()).toMatchObject({
      'mod+z': 'history.undo',
      'mod+shift+z': 'history.redo',
      'ctrl+y': 'history.redo',
    });
  });
});

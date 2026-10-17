import { describe, expect, it, vi } from 'vitest';

import type { JsonValue } from '../document';

import { defineEditorSchema } from '../schema';
import { createEditorStore } from './store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeStore(
  resolveData: (
    data: { id: string; props: Record<string, unknown> },
    ctx: {
      trigger: string;
      changed: Record<string, true>;
      signal: AbortSignal;
    },
  ) => Record<string, JsonValue> | Promise<Record<string, JsonValue>>,
) {
  const schema = defineEditorSchema({
    root: { label: 'Root', fields: {}, slots: { children: {} } },
    components: {
      product: {
        label: 'Product',
        fields: { sku: { type: 'text' } },
        resolveData: resolveData as never,
      },
    },
  });
  return createEditorStore({
    schema,
    initialValue: {
      schemaVersion: 1,
      root: {
        id: 'r',
        type: 'root',
        props: {},
        slots: {
          children: [{ id: 'p', type: 'product', props: { sku: 'a' } }],
        },
      },
    },
    genId: (() => {
      let n = 0;
      return () => `n${++n}`;
    })(),
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('resolveData', () => {
  it('runs on load, insert and change with the trigger and changed keys', () => {
    const calls: [string, string, string[]][] = [];
    const store = makeStore((data, ctx) => {
      calls.push([data.id, ctx.trigger, Object.keys(ctx.changed)]);
      return { price: `${String(data.props.sku)}-price` };
    });
    store.add('product', { parent: { id: 'r' } });
    store.update('p', { sku: 'b' });
    store.resolveData('p');
    expect(calls).toEqual([
      ['p', 'load', []],
      ['n1', 'insert', []],
      ['p', 'change', ['sku']],
      ['p', 'force', []],
    ]);
    expect(store.getSession().computed.p).toEqual({ price: 'b-price' });
  });

  it('keeps computed values out of the document', () => {
    const store = makeStore(() => ({ price: 10 }));
    expect(store.getSession().computed.p).toEqual({ price: 10 });
    expect(store.getDocument().root.slots?.children?.[0]?.props).toEqual({
      sku: 'a',
    });
  });

  it('tracks loading and errors per node', async () => {
    const pending = deferred<Record<string, JsonValue>>();
    const store = makeStore(() => pending.promise);
    expect(store.getSession().nodeStatus.p).toEqual({
      loading: true,
      error: null,
    });
    pending.reject(new Error('offline'));
    await flush();
    expect(store.getSession().nodeStatus.p?.error?.message).toBe('offline');
  });

  it('a newer run aborts the older one; only the newest result lands', async () => {
    const runs: {
      signal: AbortSignal;
      d: ReturnType<typeof deferred<Record<string, JsonValue>>>;
    }[] = [];
    const store = makeStore((_data, ctx) => {
      const d = deferred<Record<string, JsonValue>>();
      runs.push({ signal: ctx.signal, d });
      return d.promise;
    });
    store.update('p', { sku: 'b' });
    expect(runs[0]?.signal.aborted).toBe(true);
    runs[1]?.d.resolve({ price: 'new' });
    runs[0]?.d.resolve({ price: 'old' });
    await flush();
    expect(store.getSession().computed.p).toEqual({ price: 'new' });
    expect(store.getSession().nodeStatus.p).toBeUndefined();
  });

  it('forgets results of removed nodes', () => {
    const store = makeStore(() => ({ price: 1 }));
    store.remove('p');
    expect(store.getSession().computed).toEqual({});
  });

  it('a throwing resolveData reports an error without breaking the edit', () => {
    const spy = vi.fn(() => {
      throw new Error('bad');
    });
    const store = makeStore(spy);
    expect(store.update('p', { sku: 'z' })).toBe(true);
    expect(store.getSession().nodeStatus.p?.error?.message).toBe('bad');
  });
});

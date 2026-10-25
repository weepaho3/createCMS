// @vitest-environment happy-dom
import type * as React from 'react';

import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  shallowEqual,
  useDocSelector,
  useEditorStore,
  useEphemeralSelector,
  useSessionSelector,
} from './binding';
import { counterGenId, makeDoc, storeSchema } from './core/store/fixtures';
import { Editor } from './index';

afterEach(cleanup);

function makeWrapper() {
  const genId = counterGenId();
  return ({ children }: { children: React.ReactNode }) => (
    <Editor.Root schema={storeSchema} defaultValue={makeDoc()} genId={genId}>
      {children}
    </Editor.Root>
  );
}

describe('shallowEqual', () => {
  it('treats NaN as equal to NaN (Object.is)', () => {
    expect(shallowEqual(NaN, NaN)).toBe(true);
  });

  it('treats the same reference as equal', () => {
    const obj = { a: 1 };
    expect(shallowEqual(obj, obj)).toBe(true);
  });

  it('treats equal flat objects as equal', () => {
    expect(shallowEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it('treats objects with different key counts as unequal', () => {
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('treats nested objects with different inner references as unequal', () => {
    expect(shallowEqual({ a: { x: 1 } }, { a: { x: 1 } })).toBe(false);
  });

  it('treats arrays with equal entries by index as equal', () => {
    expect(shallowEqual([1, 2, 3], [1, 2, 3])).toBe(true);
  });

  it('treats an array and a plain object as unequal', () => {
    expect(shallowEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
  });

  it('treats null and an object as unequal', () => {
    expect(shallowEqual(null, { a: 1 })).toBe(false);
  });
});

describe('useDocSelector', () => {
  it('re-renders only when the selected slice changes', () => {
    let renders = 0;
    let store: ReturnType<typeof useEditorStore> | undefined;
    const { result } = renderHook(
      () => {
        renders++;
        store = useEditorStore();
        return useDocSelector((s) => s.nodes.h1?.props.text);
      },
      { wrapper: makeWrapper() },
    );
    expect(result.current).toBe('Hello');
    expect(renders).toBe(1);

    act(() => {
      store?.update('p1', { text: 'x' });
    });
    expect(renders).toBe(1);

    act(() => {
      store?.update('h1', { text: 'y' });
    });
    expect(renders).toBe(2);
    expect(result.current).toBe('y');
  });

  it('an object selector renders once, does not loop, and does not re-render on an unrelated update', () => {
    let renders = 0;
    let store: ReturnType<typeof useEditorStore> | undefined;
    const { result } = renderHook(
      () => {
        renders++;
        store = useEditorStore();
        return useDocSelector((s) => ({
          n: s.nodes.root_1?.slots.children.length,
        }));
      },
      { wrapper: makeWrapper() },
    );
    expect(renders).toBe(1);
    expect(result.current).toEqual({ n: 2 });

    act(() => {
      store?.update('root_1', { title: 'New title' });
    });
    expect(renders).toBe(1);
  });

  it('an object selector re-renders once when its value actually changes', () => {
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders++;
        const store = useEditorStore();
        const slice = useDocSelector((s) => ({
          n: s.nodes.root_1?.slots.children.length,
        }));
        return { store, slice };
      },
      { wrapper: makeWrapper() },
    );
    expect(renders).toBe(1);
    act(() => {
      result.current.store.add('heading', { parent: { id: 'root_1' } });
    });
    expect(renders).toBe(2);
    expect(result.current.slice).toEqual({ n: 3 });
  });

  it('a selector that closes over a prop recomputes when the prop changes without a store change', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useDocSelector((s) => s.nodes[id]?.type),
      { wrapper: makeWrapper(), initialProps: { id: 'h1' } },
    );
    expect(result.current).toBe('heading');
    rerender({ id: 'sec1' });
    expect(result.current).toBe('section');
  });
});

describe('useEditorStore', () => {
  it('returns the same store object across re-renders', () => {
    const { result, rerender } = renderHook(() => useEditorStore(), {
      wrapper: makeWrapper(),
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('useDocSelector throws outside Editor.Root', () => {
    expect(() => renderHook(() => useDocSelector((s) => s.rootId))).toThrow(
      'useDocSelector must be used within an Editor.Root component.',
    );
  });
});

describe('channels', () => {
  function mountProbes() {
    const counts = { doc: 0, session: 0, hover: 0 };
    const holder: { store?: ReturnType<typeof useEditorStore> } = {};
    function DocProbe() {
      counts.doc++;
      holder.store = useEditorStore();
      return <>{useDocSelector((s) => s.nodes.h1?.props.text as string)}</>;
    }
    function SessionProbe() {
      counts.session++;
      return <>{useSessionSelector((s) => s.selection[0] ?? '')}</>;
    }
    function HoverProbe() {
      counts.hover++;
      return <>{useEphemeralSelector((s) => s.hoverId ?? '')}</>;
    }
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <DocProbe />
        <SessionProbe />
        <HoverProbe />
      </Wrapper>,
    );
    const { store } = holder;
    if (!store) throw new Error('no store');
    return { counts, store };
  }

  it('hover renders only ephemeral readers', () => {
    const { counts, store } = mountProbes();
    act(() => {
      store.hover('h1');
      store.hover('sec1');
    });
    expect(counts).toEqual({ doc: 1, session: 1, hover: 2 });
  });

  it('a document change does not render session readers', () => {
    const { counts, store } = mountProbes();
    act(() => {
      store.update('p1', { text: 'x' });
    });
    expect(counts).toEqual({ doc: 1, session: 1, hover: 1 });
    act(() => {
      store.update('h1', { text: 'y' });
    });
    expect(counts).toEqual({ doc: 2, session: 1, hover: 1 });
  });

  it('a selection change does not render document readers', () => {
    const { counts, store } = mountProbes();
    act(() => {
      store.select('h1');
    });
    expect(counts).toEqual({ doc: 1, session: 2, hover: 1 });
  });
});

// @vitest-environment happy-dom
import type * as React from 'react';

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { shallowEqual, useEditorSelector, useEditorStore } from './binding';
import { Editor } from './index';
import { counterGenId, makeTree, storeSchema } from './store/fixtures';

afterEach(cleanup);

function makeWrapper() {
  const genId = counterGenId();
  return ({ children }: { children: React.ReactNode }) => (
    <Editor.Root schema={storeSchema} defaultValue={makeTree()} genId={genId}>
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

describe('useEditorSelector', () => {
  it('re-renders only when the selected slice changes', () => {
    let renders = 0;
    let store: ReturnType<typeof useEditorStore> | undefined;
    const { result } = renderHook(
      () => {
        renders++;
        store = useEditorStore();
        return useEditorSelector((s) => s.nodes.h1?.properties.text);
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
        return useEditorSelector((s) => ({
          n: s.nodes.root_1?.childIds.length,
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
        const slice = useEditorSelector((s) => ({
          n: s.nodes.root_1?.childIds.length,
        }));
        return { store, slice };
      },
      { wrapper: makeWrapper() },
    );
    expect(renders).toBe(1);
    act(() => {
      result.current.store.add('heading', { parentId: 'root_1' });
    });
    expect(renders).toBe(2);
    expect(result.current.slice).toEqual({ n: 3 });
  });

  it('a selector that closes over a prop recomputes when the prop changes without a store change', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useEditorSelector((s) => s.nodes[id]?.type),
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

  it('useEditorSelector throws outside Editor.Root', () => {
    expect(() => renderHook(() => useEditorSelector((s) => s.rootId))).toThrow(
      'useEditorSelector must be used within an Editor.Root component.',
    );
  });
});

// @vitest-environment happy-dom
import type * as React from 'react';

import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditorRootProps } from './components';
import type { EditorApi } from './hooks';

import {
  useAnyBlock,
  useAnyField,
  useBlockActions,
  useChildren,
  useEditor,
  useFields,
  useHistory,
  usePalette,
  useSave,
  useSelection,
} from './hooks';
import { Editor } from './index';
import { counterGenId, makeTree, storeSchema } from './store/fixtures';

afterEach(cleanup);

function makeWrapper(
  overrides: Partial<Pick<EditorRootProps, 'onChange' | 'onSave'>> = {},
) {
  const genId = counterGenId();
  return ({ children }: { children: React.ReactNode }) => (
    <Editor.Root
      schema={storeSchema}
      defaultValue={makeTree()}
      genId={genId}
      onChange={overrides.onChange}
      onSave={overrides.onSave}
    >
      {children}
    </Editor.Root>
  );
}

describe('useEditor', () => {
  it('returns the same API object across re-renders', () => {
    const { result, rerender } = renderHook(() => useEditor(), {
      wrapper: makeWrapper(),
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it("exposes schema, userId: 'local', store, and working actions", () => {
    const { result } = renderHook(() => useEditor(), {
      wrapper: makeWrapper(),
    });
    expect(result.current.schema).toBe(storeSchema);
    expect(result.current.userId).toBe('local');
    expect(typeof result.current.store.getState).toBe('function');
    let id: string | null = null;
    act(() => {
      id = result.current.add('heading', { parentId: 'root_1' });
    });
    expect(id).toBe('n1');
    expect(result.current.getState().nodes.n1).toBeDefined();
  });
});

describe('useEditor(selector)', () => {
  it('returns the slice and updates after an acted change', () => {
    const { result } = renderHook(
      () => ({
        api: useEditor(),
        slice: useEditor((s) => s.nodes.h1?.properties.text),
      }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.slice).toBe('Hello');
    act(() => {
      result.current.api.update('h1', { text: 'Changed' });
    });
    expect(result.current.slice).toBe('Changed');
  });
});

describe('useAnyBlock', () => {
  it("exposes 'h1's data, spec and identity fields", () => {
    const { result } = renderHook(() => useAnyBlock('h1'), {
      wrapper: makeWrapper(),
    });
    expect(result.current?.type).toBe('heading');
    expect(result.current?.properties.text).toBe('Hello');
    expect(result.current?.spec.text?.type).toBe('string');
    expect(result.current?.childIds).toEqual([]);
    expect(result.current?.parentId).toBe('root_1');
  });

  it("set('text', 'X') updates the block and the hook re-renders with a new handle", () => {
    const { result } = renderHook(
      () => ({ api: useEditor(), block: useAnyBlock('h1') }),
      { wrapper: makeWrapper() },
    );
    const before = result.current.block;
    act(() => {
      before?.set('text', 'X');
    });
    expect(result.current.block?.properties.text).toBe('X');
    expect(result.current.block).not.toBe(before);
  });

  it("field('level') has spec.type 'number', value 1, and its set(3) updates it", () => {
    const { result } = renderHook(
      () => ({ api: useEditor(), block: useAnyBlock('h1') }),
      { wrapper: makeWrapper() },
    );
    const field = result.current.block?.field('level');
    expect(field?.spec?.type).toBe('number');
    expect(field?.value).toBe(1);
    act(() => {
      result.current.block?.field('level').set(3);
    });
    expect(result.current.block?.field('level').value).toBe(3);
  });

  it('returns null for an unknown id', () => {
    const { result } = renderHook(() => useAnyBlock('nope'), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toBeNull();
  });

  it('useAnyBlock(null) returns null', () => {
    const { result } = renderHook(() => useAnyBlock(null), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toBeNull();
  });

  it('keeps the same handle identity across re-renders when the node did not change, and gets a new one when it did', () => {
    const { result, rerender } = renderHook(
      () => ({ api: useEditor(), block: useAnyBlock('h1') }),
      { wrapper: makeWrapper() },
    );
    const first = result.current.block;
    rerender();
    expect(result.current.block).toBe(first);
    act(() => {
      result.current.api.update('h1', { text: 'Y' });
    });
    expect(result.current.block).not.toBe(first);
  });
});

describe('useAnyField', () => {
  it("value 'Hello', spec.type 'string', set('Y') updates it", () => {
    const { result } = renderHook(() => useAnyField('h1', 'text'), {
      wrapper: makeWrapper(),
    });
    expect(result.current.value).toBe('Hello');
    expect(result.current.spec?.type).toBe('string');
    act(() => {
      result.current.set('Y');
    });
    expect(result.current.value).toBe('Y');
  });

  it('an undeclared key has spec undefined', () => {
    const { result } = renderHook(() => useAnyField('h1', 'nope'), {
      wrapper: makeWrapper(),
    });
    expect(result.current.spec).toBeUndefined();
  });

  it('an unknown block has value undefined and spec undefined', () => {
    const { result } = renderHook(() => useAnyField('nope', 'text'), {
      wrapper: makeWrapper(),
    });
    expect(result.current.value).toBeUndefined();
    expect(result.current.spec).toBeUndefined();
  });
});

describe('useFields', () => {
  it("returns keys ['text','level'] in order for 'h1'", () => {
    const { result } = renderHook(() => useFields('h1'), {
      wrapper: makeWrapper(),
    });
    expect(result.current.map((f) => f.key)).toEqual(['text', 'level']);
  });

  it("returns ['title'] for 'root_1'", () => {
    const { result } = renderHook(() => useFields('root_1'), {
      wrapper: makeWrapper(),
    });
    expect(result.current.map((f) => f.key)).toEqual(['title']);
  });

  it('returns [] for an unknown block', () => {
    const { result } = renderHook(() => useFields('nope'), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toEqual([]);
  });

  it('keeps the same array identity across re-renders', () => {
    const { result, rerender } = renderHook(() => useFields('h1'), {
      wrapper: makeWrapper(),
    });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('useChildren', () => {
  it("returns child refs for 'root_1', same array reference across re-renders and unrelated updates", () => {
    const { result, rerender } = renderHook(
      () => ({ api: useEditor(), children: useChildren('root_1') }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.children).toEqual([
      { id: 'h1', type: 'heading', index: 0 },
      { id: 'sec1', type: 'section', index: 1 },
    ]);
    const first = result.current.children;
    rerender();
    expect(result.current.children).toBe(first);
    act(() => {
      result.current.api.update('h1', { text: 'x' });
    });
    expect(result.current.children).toBe(first);
  });

  it('grows to three refs after add', () => {
    const { result } = renderHook(
      () => ({ api: useEditor(), children: useChildren('root_1') }),
      { wrapper: makeWrapper() },
    );
    act(() => {
      result.current.api.add('heading', { parentId: 'root_1' });
    });
    expect(result.current.children).toEqual([
      { id: 'h1', type: 'heading', index: 0 },
      { id: 'sec1', type: 'section', index: 1 },
      { id: 'n1', type: 'heading', index: 2 },
    ]);
  });

  it('returns [] for an unknown parent, same EMPTY reference twice', () => {
    const { result } = renderHook(
      () => ({ a: useChildren('nope'), b: useChildren('also-nope') }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.a).toEqual([]);
    expect(result.current.b).toEqual([]);
    expect(result.current.a).toBe(result.current.b);
  });
});

describe('useBlockActions', () => {
  it('h1 is index 0, cannot move up, can move down, cannot have children', () => {
    const { result } = renderHook(() => useBlockActions('h1'), {
      wrapper: makeWrapper(),
    });
    expect(result.current.index).toBe(0);
    expect(result.current.canMoveUp).toBe(false);
    expect(result.current.canMoveDown).toBe(true);
    expect(result.current.canHaveChildren).toBe(false);
    expect(result.current.allowedChildTypes).toEqual([]);
  });

  it('sec1 can have children and accepts heading and paragraph', () => {
    const { result } = renderHook(() => useBlockActions('sec1'), {
      wrapper: makeWrapper(),
    });
    expect(result.current.canHaveChildren).toBe(true);
    expect(result.current.allowedChildTypes).toEqual(['heading', 'paragraph']);
  });

  it("add('heading') under sec1 returns an id and the child appears", () => {
    const { result } = renderHook(
      () => ({
        api: useEditor(),
        actions: useBlockActions('sec1'),
        children: useChildren('sec1'),
      }),
      { wrapper: makeWrapper() },
    );
    let id: string | null = null;
    act(() => {
      id = result.current.actions.add('heading');
    });
    expect(id).toBe('n1');
    expect(result.current.children.map((child) => child.id)).toEqual([
      'p1',
      'n1',
    ]);
  });

  it("add('image') under sec1 returns null (placement)", () => {
    const { result } = renderHook(() => useBlockActions('sec1'), {
      wrapper: makeWrapper(),
    });
    let id: string | null = 'unset';
    act(() => {
      id = result.current.add('image');
    });
    expect(id).toBeNull();
  });

  it('moveDown() on h1 reorders root children and then canMoveDown is false', () => {
    const { result } = renderHook(
      () => ({ api: useEditor(), actions: useBlockActions('h1') }),
      { wrapper: makeWrapper() },
    );
    let moved = false;
    act(() => {
      moved = result.current.actions.moveDown();
    });
    expect(moved).toBe(true);
    expect(result.current.api.getState().nodes.root_1?.childIds).toEqual([
      'sec1',
      'h1',
    ]);
    expect(result.current.actions.canMoveDown).toBe(false);
  });

  it('moveUp() on the first child returns false', () => {
    const { result } = renderHook(() => useBlockActions('h1'), {
      wrapper: makeWrapper(),
    });
    let moved = true;
    act(() => {
      moved = result.current.moveUp();
    });
    expect(moved).toBe(false);
  });

  it('remove() on p1 returns true and the node is gone', () => {
    const { result } = renderHook(
      () => ({ api: useEditor(), actions: useBlockActions('p1') }),
      { wrapper: makeWrapper() },
    );
    let removed = false;
    act(() => {
      removed = result.current.actions.remove();
    });
    expect(removed).toBe(true);
    expect(result.current.api.getState().nodes.p1).toBeUndefined();
  });

  it('duplicate() on h1 returns a new id right after h1', () => {
    const { result } = renderHook(
      () => ({ api: useEditor(), actions: useBlockActions('h1') }),
      { wrapper: makeWrapper() },
    );
    let id: string | null = null;
    act(() => {
      id = result.current.actions.duplicate();
    });
    expect(id).toBe('n1');
    expect(result.current.api.getState().nodes.root_1?.childIds).toEqual([
      'h1',
      'n1',
      'sec1',
    ]);
  });

  it('root: cannot move or remove or duplicate; can have children', () => {
    const { result } = renderHook(() => useBlockActions('root_1'), {
      wrapper: makeWrapper(),
    });
    expect(result.current.canMoveUp).toBe(false);
    expect(result.current.canMoveDown).toBe(false);
    expect(result.current.canHaveChildren).toBe(true);
    let removed = true;
    let duplicated: string | null = 'unset';
    act(() => {
      removed = result.current.remove();
      duplicated = result.current.duplicate();
    });
    expect(removed).toBe(false);
    expect(duplicated).toBeNull();
  });

  it('unknown id: type is null and everything is inert', () => {
    const { result } = renderHook(() => useBlockActions('nope'), {
      wrapper: makeWrapper(),
    });
    expect(result.current.type).toBeNull();
    expect(result.current.parentId).toBeNull();
    expect(result.current.index).toBe(-1);
    expect(result.current.canMoveUp).toBe(false);
    expect(result.current.canMoveDown).toBe(false);
    expect(result.current.canHaveChildren).toBe(false);
    expect(result.current.allowedChildTypes).toEqual([]);
    let added: string | null = 'unset';
    let removed = true;
    let duplicated: string | null = 'unset';
    let up = true;
    let down = true;
    act(() => {
      added = result.current.add('heading');
      removed = result.current.remove();
      duplicated = result.current.duplicate();
      up = result.current.moveUp();
      down = result.current.moveDown();
    });
    expect(added).toBeNull();
    expect(removed).toBe(false);
    expect(duplicated).toBeNull();
    expect(up).toBe(false);
    expect(down).toBe(false);
  });

  it('returned object identity is stable across an unrelated re-render', () => {
    const { result, rerender } = renderHook(
      () => ({ api: useEditor(), actions: useBlockActions('sec1') }),
      { wrapper: makeWrapper() },
    );
    const first = result.current.actions;
    rerender();
    expect(result.current.actions).toBe(first);
    act(() => {
      result.current.api.update('h1', { text: 'x' });
    });
    expect(result.current.actions).toBe(first);
  });
});

describe('useSelection', () => {
  it('starts with everything null', () => {
    const { result } = renderHook(() => useSelection(), {
      wrapper: makeWrapper(),
    });
    expect(result.current).toEqual({
      selected: null,
      hovered: null,
      focus: null,
      editing: null,
    });
  });

  it("follows store.select('h1')", () => {
    const { result } = renderHook(
      () => ({ api: useEditor(), selection: useSelection() }),
      { wrapper: makeWrapper() },
    );
    act(() => {
      result.current.api.select('h1');
    });
    expect(result.current.selection.selected).toBe('h1');
  });

  it("setUserSelection('u2', …) updates useSelection('u2') and leaves the local selection unchanged", () => {
    const { result } = renderHook(
      () => ({
        api: useEditor(),
        local: useSelection(),
        u2: useSelection('u2'),
      }),
      { wrapper: makeWrapper() },
    );
    act(() => {
      result.current.api.setUserSelection('u2', { selected: 'p1' });
    });
    expect(result.current.u2.selected).toBe('p1');
    expect(result.current.local.selected).toBeNull();
  });
});

describe('useHistory', () => {
  it('canUndo is false initially', () => {
    const { result } = renderHook(() => useHistory(), {
      wrapper: makeWrapper(),
    });
    expect(result.current.canUndo).toBe(false);
  });

  it('canUndo becomes true after an add', () => {
    const { result } = renderHook(
      () => ({ api: useEditor(), history: useHistory() }),
      { wrapper: makeWrapper() },
    );
    act(() => {
      result.current.api.add('heading', { parentId: 'root_1' });
    });
    expect(result.current.history.canUndo).toBe(true);
  });

  it('undo() via the hook restores and canRedo becomes true', () => {
    const { result } = renderHook(
      () => ({ api: useEditor(), history: useHistory() }),
      { wrapper: makeWrapper() },
    );
    act(() => {
      result.current.api.add('heading', { parentId: 'root_1' });
    });
    act(() => {
      result.current.history.undo();
    });
    expect(result.current.api.getState().nodes.n1).toBeUndefined();
    expect(result.current.history.canRedo).toBe(true);
  });
});

describe('useSave / useDirty', () => {
  it('dirty is false initially', () => {
    const { result } = renderHook(() => useSave(), {
      wrapper: makeWrapper(),
    });
    expect(result.current.dirty).toBe(false);
  });

  it('dirty becomes true after an update', () => {
    const { result } = renderHook(
      () => ({ api: useEditor(), save: useSave() }),
      { wrapper: makeWrapper() },
    );
    act(() => {
      result.current.api.update('h1', { text: 'X' });
    });
    expect(result.current.save.dirty).toBe(true);
  });

  it("save({ message: 'm' }) calls the Root's onSave with (tree, { message: 'm' }), is saving during the call, then clears dirty", async () => {
    const onSave = vi.fn();
    const { result } = renderHook(
      () => ({ api: useEditor(), save: useSave() }),
      { wrapper: makeWrapper({ onSave }) },
    );
    let sawSavingDuringCall = false;
    onSave.mockImplementation(async (tree, meta) => {
      // The store's own state (not the last React render, which has not
      // flushed yet at this synchronous point) reflects `saving` correctly.
      sawSavingDuringCall = result.current.api.getState().saving;
      expect(meta).toEqual({ message: 'm' });
      expect(tree.blockId).toBe('root_1');
    });
    act(() => {
      result.current.api.update('h1', { text: 'X' });
    });
    await act(async () => {
      await result.current.save.save({ message: 'm' });
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(sawSavingDuringCall).toBe(true);
    expect(result.current.save.dirty).toBe(false);
  });
});

describe('usePalette', () => {
  it('lists 4 items in definition order, with a stable array reference', () => {
    const { result, rerender } = renderHook(() => usePalette(), {
      wrapper: makeWrapper(),
    });
    expect(result.current.map((item) => item.type)).toEqual([
      'heading',
      'paragraph',
      'image',
      'section',
    ]);
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('Root callbacks', () => {
  it('onChange receives { ops, version, getTree }', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useEditor(), {
      wrapper: makeWrapper({ onChange }),
    });
    act(() => {
      result.current.add('heading', { parentId: 'root_1' });
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const change = onChange.mock.calls[0]?.[0];
    expect(change.ops[0].op).toBe('add');
    expect(typeof change.getTree).toBe('function');
    expect(change.getTree().children).toHaveLength(3);
  });

  it('a new onChange prop passed on re-render is the one called by the next change', () => {
    const onChangeA = vi.fn();
    const onChangeB = vi.fn();
    let api: EditorApi | undefined;
    function Probe() {
      api = useEditor();
      return null;
    }
    function Harness({ onChange }: { onChange: EditorRootProps['onChange'] }) {
      return (
        <Editor.Root
          schema={storeSchema}
          defaultValue={makeTree()}
          genId={counterGenId()}
          onChange={onChange}
        >
          <Probe />
        </Editor.Root>
      );
    }
    const { rerender } = render(<Harness onChange={onChangeA} />);
    rerender(<Harness onChange={onChangeB} />);
    act(() => {
      api?.add('heading', { parentId: 'root_1' });
    });
    expect(onChangeA).not.toHaveBeenCalled();
    expect(onChangeB).toHaveBeenCalledTimes(1);
  });
});

describe('key reset', () => {
  it('a new key creates a fresh store from the new defaultValue', () => {
    const treeA = makeTree();
    const treeB = { ...makeTree(), blockId: 'root_2' };
    let api: EditorApi | undefined;
    function Probe() {
      api = useEditor();
      return null;
    }
    const { rerender } = render(
      <Editor.Root
        key="a"
        schema={storeSchema}
        defaultValue={treeA}
        genId={counterGenId()}
      >
        <Probe />
      </Editor.Root>,
    );
    act(() => {
      api?.update('h1', { text: 'edited' });
    });
    expect(api?.isDirty()).toBe(true);

    rerender(
      <Editor.Root
        key="b"
        schema={storeSchema}
        defaultValue={treeB}
        genId={counterGenId()}
      >
        <Probe />
      </Editor.Root>,
    );
    expect(api?.getState().rootId).toBe('root_2');
    expect(api?.isDirty()).toBe(false);
    expect(api?.getState().history.past).toEqual([]);
  });

  it('re-rendering with a different defaultValue but the same key keeps the old store', () => {
    const treeA = makeTree();
    const treeB = { ...makeTree(), blockId: 'root_2' };
    let api: EditorApi | undefined;
    function Probe() {
      api = useEditor();
      return null;
    }
    const { rerender } = render(
      <Editor.Root
        key="same"
        schema={storeSchema}
        defaultValue={treeA}
        genId={counterGenId()}
      >
        <Probe />
      </Editor.Root>,
    );
    const store = api?.store;

    rerender(
      <Editor.Root
        key="same"
        schema={storeSchema}
        defaultValue={treeB}
        genId={counterGenId()}
      >
        <Probe />
      </Editor.Root>,
    );
    expect(api?.store).toBe(store);
    expect(api?.getState().rootId).toBe('root_1');
  });
});

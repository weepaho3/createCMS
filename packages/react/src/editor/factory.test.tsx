// @vitest-environment happy-dom
import type * as React from 'react';

import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorFactory, TreeOf } from './factory';

import { createEditor } from './factory';
import { Editor } from './index';
import { pages } from './schema/fixtures';
import { counterGenId, makeTree, storeSchema } from './store/fixtures';

afterEach(cleanup);

/** `makeTree()` typed as `storeSchema` demands it — the union members are structurally comparable to `BlockTreeNode`. */
const typedTree = (): TreeOf<typeof storeSchema> =>
  makeTree() as TreeOf<typeof storeSchema>;

const pagesTree = (): TreeOf<typeof pages> => ({
  blockId: 'root_1',
  type: 'root',
  properties: { title: 'x' },
  children: [],
});

function rootWrapper(factory: EditorFactory<typeof storeSchema>) {
  return ({ children }: { children: React.ReactNode }) => (
    <factory.Root defaultValue={typedTree()} genId={counterGenId()}>
      {children}
    </factory.Root>
  );
}

describe('createEditor', () => {
  it('returns an object with schema, Root, the hooks and types', () => {
    const factory = createEditor({ schema: storeSchema });
    expect(factory.schema).toBe(storeSchema);
    expect(typeof factory.Root).toBe('function');
    expect(typeof factory.Preview).toBe('function');
    expect(typeof factory.useEditor).toBe('function');
    expect(typeof factory.useBlock).toBe('function');
    expect(typeof factory.useField).toBe('function');
    expect(typeof factory.useChildren).toBe('function');
    expect(typeof factory.useBlockActions).toBe('function');
    expect(typeof factory.useSelection).toBe('function');
    expect(typeof factory.useHistory).toBe('function');
    expect(typeof factory.useEditorKeyboard).toBe('function');
    expect(typeof factory.useSave).toBe('function');
    expect(typeof factory.useDirty).toBe('function');
    expect(typeof factory.usePalette).toBe('function');
    expect(factory.types).toEqual({});
  });
});

describe('factory.Root', () => {
  it('renders children and provides the store', () => {
    const factory = createEditor({ schema: storeSchema });
    function Probe() {
      const api = factory.useEditor();
      return <span data-testid="probe">{api.getState().rootId}</span>;
    }
    const { getByTestId } = render(
      <factory.Root defaultValue={typedTree()} genId={counterGenId()}>
        <Probe />
      </factory.Root>,
    );
    expect(getByTestId('probe').textContent).toBe('root_1');
  });

  it("factory.useEditor().add('heading', { parentId: 'root_1' }) inside act adds a block seeded with level: 2", () => {
    const factory = createEditor({ schema: storeSchema });
    const { result } = renderHook(() => factory.useEditor(), {
      wrapper: rootWrapper(factory),
    });
    let id: string | null = null;
    act(() => {
      id = result.current.add('heading', { parentId: 'root_1' });
    });
    expect(id).toBe('n1');
    expect(result.current.getState().nodes.n1?.properties.level).toBe(2);
  });
});

describe('factory.useBlock', () => {
  it("narrows at runtime: type 'heading', properties.text 'Hello'", () => {
    const factory = createEditor({ schema: storeSchema });
    const { result } = renderHook(() => factory.useBlock('h1'), {
      wrapper: rootWrapper(factory),
    });
    expect(result.current?.type).toBe('heading');
    if (result.current?.type === 'heading') {
      expect(result.current.properties.text).toBe('Hello');
    }
  });

  it("set('text', 'Z') updates the block", () => {
    const factory = createEditor({ schema: storeSchema });
    const { result } = renderHook(() => factory.useBlock('h1'), {
      wrapper: rootWrapper(factory),
    });
    act(() => {
      if (result.current?.type === 'heading') {
        result.current.set('text', 'Z');
      }
    });
    expect(
      result.current?.type === 'heading'
        ? result.current.properties.text
        : undefined,
    ).toBe('Z');
  });

  it("useBlock('root_1').type === 'root'", () => {
    const factory = createEditor({ schema: storeSchema });
    const { result } = renderHook(() => factory.useBlock('root_1'), {
      wrapper: rootWrapper(factory),
    });
    expect(result.current?.type).toBe('root');
  });
});

describe('factory.useField', () => {
  it("{ id: 'h1', type: 'heading' }, 'level' returns value 1, spec.type 'number', and set(4) updates it", () => {
    const factory = createEditor({ schema: storeSchema });
    const { result } = renderHook(
      () => factory.useField({ id: 'h1', type: 'heading' }, 'level'),
      { wrapper: rootWrapper(factory) },
    );
    expect(result.current.value).toBe(1);
    expect(result.current.spec.type).toBe('number');
    act(() => {
      result.current.set(4);
    });
    expect(result.current.value).toBe(4);
  });
});

describe('the remaining factory hooks mirror the untyped ones', () => {
  it('usePalette() returns 4 items', () => {
    const factory = createEditor({ schema: storeSchema });
    const { result } = renderHook(() => factory.usePalette(), {
      wrapper: rootWrapper(factory),
    });
    expect(result.current).toHaveLength(4);
  });

  it("useChildren('root_1') returns 2 child refs", () => {
    const factory = createEditor({ schema: storeSchema });
    const { result } = renderHook(() => factory.useChildren('root_1'), {
      wrapper: rootWrapper(factory),
    });
    expect(result.current).toEqual([
      { id: 'h1', type: 'heading', index: 0 },
      { id: 'sec1', type: 'section', index: 1 },
    ]);
  });

  it("useBlockActions('sec1') lists heading and paragraph", () => {
    const factory = createEditor({ schema: storeSchema });
    const { result } = renderHook(() => factory.useBlockActions('sec1'), {
      wrapper: rootWrapper(factory),
    });
    expect(result.current.allowedChildTypes).toEqual(['heading', 'paragraph']);
  });

  it('useHistory().canUndo goes false → true after an add', () => {
    const factory = createEditor({ schema: storeSchema });
    const { result } = renderHook(
      () => ({ api: factory.useEditor(), history: factory.useHistory() }),
      { wrapper: rootWrapper(factory) },
    );
    expect(result.current.history.canUndo).toBe(false);
    act(() => {
      result.current.api.add('heading', { parentId: 'root_1' });
    });
    expect(result.current.history.canUndo).toBe(true);
  });

  it('useSave().dirty goes false → true', () => {
    const factory = createEditor({ schema: storeSchema });
    const { result } = renderHook(
      () => ({ api: factory.useEditor(), save: factory.useSave() }),
      { wrapper: rootWrapper(factory) },
    );
    expect(result.current.save.dirty).toBe(false);
    act(() => {
      result.current.api.update('h1', { text: 'X' });
    });
    expect(result.current.save.dirty).toBe(true);
  });

  it('useDirty() mirrors useSave().dirty', () => {
    const factory = createEditor({ schema: storeSchema });
    const { result } = renderHook(
      () => ({ api: factory.useEditor(), dirty: factory.useDirty() }),
      { wrapper: rootWrapper(factory) },
    );
    expect(result.current.dirty).toBe(false);
    act(() => {
      result.current.api.update('h1', { text: 'X' });
    });
    expect(result.current.dirty).toBe(true);
  });

  it('useSelection().selected follows select', () => {
    const factory = createEditor({ schema: storeSchema });
    const { result } = renderHook(
      () => ({ api: factory.useEditor(), selection: factory.useSelection() }),
      { wrapper: rootWrapper(factory) },
    );
    act(() => {
      result.current.api.select('h1');
    });
    expect(result.current.selection.selected).toBe('h1');
  });
});

describe('schema guard', () => {
  it('throws when rendered under a plain Editor.Root with a different schema object', () => {
    const factory = createEditor({ schema: storeSchema });
    function Probe() {
      factory.useEditor();
      return null;
    }
    expect(() =>
      render(
        <Editor.Root schema={pages} defaultValue={pagesTree()}>
          <Probe />
        </Editor.Root>,
      ),
    ).toThrow(
      'useEditor: the enclosing Editor.Root uses a different schema than ' +
        'this createEditor() instance',
    );
  });

  it('works when rendered under a plain Editor.Root with the same schema object', () => {
    const factory = createEditor({ schema: storeSchema });
    function Probe() {
      const api = factory.useEditor();
      return <span data-testid="probe">{api.getState().rootId}</span>;
    }
    const { getByTestId } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <Probe />
      </Editor.Root>,
    );
    expect(getByTestId('probe').textContent).toBe('root_1');
  });

  it('works when rendered under factory.Root', () => {
    const factory = createEditor({ schema: storeSchema });
    function Probe() {
      const api = factory.useEditor();
      return <span data-testid="probe">{api.getState().rootId}</span>;
    }
    const { getByTestId } = render(
      <factory.Root defaultValue={typedTree()}>
        <Probe />
      </factory.Root>,
    );
    expect(getByTestId('probe').textContent).toBe('root_1');
  });
});

describe('nesting two factories', () => {
  it('an inner factoryB.Root inside factoryA.Root: factoryB.useEditor() works, factoryA.useEditor() throws', () => {
    const factoryA = createEditor({ schema: storeSchema });
    const factoryB = createEditor({ schema: pages });
    let innerBRootId: string | undefined;
    let innerAThrewMessage: string | undefined;
    function InnerProbe() {
      innerBRootId = factoryB.useEditor().getState().rootId;
      try {
        factoryA.useEditor();
      } catch (err) {
        innerAThrewMessage = err instanceof Error ? err.message : String(err);
      }
      return null;
    }
    render(
      <factoryA.Root defaultValue={typedTree()}>
        <factoryB.Root defaultValue={pagesTree()}>
          <InnerProbe />
        </factoryB.Root>
      </factoryA.Root>,
    );
    expect(innerBRootId).toBe('root_1');
    expect(innerAThrewMessage).toContain(
      'useEditor: the enclosing Editor.Root uses a different schema',
    );
  });
});

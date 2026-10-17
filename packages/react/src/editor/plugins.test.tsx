// @vitest-environment happy-dom
import type * as React from 'react';

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FieldControlProps } from './field/types';

import { EditorAdapterError } from './core/adapter';
import { defineEditorPlugin } from './core/plugin';
import { defineEditorSchema } from './core/schema';
import { createEditorStore } from './core/store';
import { counterGenId, makeDoc, storeSchema } from './core/store/fixtures';
import {
  Editor,
  useCommand,
  useEditor,
  useEditorKeyboard,
  useSaveConflict,
  useSelection,
} from './index';

afterEach(cleanup);

describe('Editor.Root with an injected store', () => {
  it('two roots share one store; the store outlives a re-mount', () => {
    const store = createEditorStore({
      schema: storeSchema,
      initialValue: makeDoc(),
      genId: counterGenId(),
    });
    function Selected({ testId }: { testId: string }) {
      return <span data-testid={testId}>{useSelection().selected ?? '-'}</span>;
    }
    const { getByTestId, rerender } = render(
      <>
        <Editor.Root store={store}>
          <Selected testId="a" />
        </Editor.Root>
        <Editor.Root store={store}>
          <Selected testId="b" />
        </Editor.Root>
      </>,
    );
    act(() => {
      store.select('h1');
    });
    expect(getByTestId('a').textContent).toBe('h1');
    expect(getByTestId('b').textContent).toBe('h1');
    rerender(
      <Editor.Root key="remounted" store={store}>
        <Selected testId="a" />
      </Editor.Root>,
    );
    expect(getByTestId('a').textContent).toBe('h1');
  });

  it('onChange and onError follow the injected store', () => {
    const store = createEditorStore({
      schema: storeSchema,
      initialValue: makeDoc(),
    });
    const onChange = vi.fn();
    const onError = vi.fn();
    render(<Editor.Root store={store} onChange={onChange} onError={onError} />);
    act(() => {
      store.update('h1', { text: 'x' });
      store.dispatch({ type: 'nope', payload: null });
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'local' }),
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'unknown-command' }),
    );
  });
});

describe('plugins end to end', () => {
  const schema = defineEditorSchema({
    root: { label: 'Root', fields: {}, slots: { children: {} } },
    components: {
      badge: {
        label: 'Badge',
        fields: { icon: { type: 'custom', kind: 'icon', label: 'Icon' } },
      },
    },
  });
  const doc = {
    schemaVersion: 1,
    root: {
      id: 'r',
      type: 'root',
      props: {},
      slots: {
        children: [{ id: 'b1', type: 'badge', props: { icon: 'star' } }],
      },
    },
  };

  function IconControl({ value }: FieldControlProps<'custom'>) {
    return <span data-testid="icon-control">{String(value)}</span>;
  }
  function ToolbarButton() {
    const command = useCommand('badge.add');
    return (
      <button type="button" onClick={() => command?.run()}>
        {command?.label} ({command?.shortcut})
      </button>
    );
  }

  const plugin = defineEditorPlugin({
    name: 'badges',
    fields: { icon: { control: IconControl } },
    commands: {
      'badge.add': {
        label: 'Add badge',
        run: (store) => store.add('badge', { parent: { id: 'r' } }),
      },
    },
    shortcuts: { 'Mod+Shift+b': 'badge.add' },
    slots: { 'block-toolbar': ToolbarButton },
  });

  function Keys({ children }: { children: React.ReactNode }) {
    const ref = { current: null as HTMLDivElement | null };
    useEditorKeyboard(ref);
    return (
      <div
        ref={(el) => void (ref.current = el)}
        tabIndex={-1}
        data-testid="scope"
      >
        {children}
      </div>
    );
  }

  it('adds a field control, a command, a shortcut and a toolbar outlet without forking', () => {
    const { getByTestId, getByRole } = render(
      <Editor.Root schema={schema} defaultValue={doc} plugins={[plugin]}>
        <Editor.Field blockId="b1" name="icon">
          <Editor.FieldControl />
        </Editor.Field>
        <Editor.Slot name="block-toolbar" />
        <Editor.Slot
          name="inspector-footer"
          fallback={<i data-testid="none" />}
        />
      </Editor.Root>,
    );
    expect(getByTestId('icon-control').textContent).toBe('star');
    expect(getByTestId('none')).toBeTruthy();
    const button = getByRole('button', { name: /Add badge/ });
    expect(button.textContent).toContain('mod+shift+b');
    fireEvent.click(button);
    expect(
      document.querySelectorAll('[data-testid="icon-control"]'),
    ).toHaveLength(1);
  });

  it('runs a plugin shortcut', () => {
    const probe: { count: number } = { count: 0 };
    function Count() {
      probe.count = useEditor((s) => s.nodes.r?.slots.children?.length ?? 0);
      return null;
    }
    const { getByTestId } = render(
      <Editor.Root schema={schema} defaultValue={doc} plugins={[plugin]}>
        <Keys>
          <Count />
        </Keys>
      </Editor.Root>,
    );
    fireEvent.keyDown(getByTestId('scope'), {
      key: 'B',
      metaKey: true,
      shiftKey: true,
    });
    expect(probe.count).toBe(2);
  });
});

describe('useSaveConflict', () => {
  it('offers reload, overwrite and copyMine during a conflict', async () => {
    const serverDoc = makeDoc();
    serverDoc.root.props.title = 'Server';
    const save = vi
      .fn()
      .mockRejectedValueOnce(
        new EditorAdapterError('conflict', 'moved on', {
          serverDoc,
          serverVersion: 'v9',
        }),
      )
      .mockResolvedValue({ version: 'v10' });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const { result } = renderHook(
      () => ({ api: useEditor(), conflict: useSaveConflict() }),
      {
        wrapper: ({ children }) => (
          <Editor.Root
            schema={storeSchema}
            defaultValue={makeDoc()}
            persistence={{ save, baseVersion: 'v1', autosave: false }}
          >
            {children}
          </Editor.Root>
        ),
      },
    );
    expect(result.current.conflict).toBeNull();
    act(() => {
      result.current.api.update('h1', { text: 'Mine' });
    });
    await act(async () => {
      await result.current.api.save();
    });
    const conflict = result.current.conflict;
    expect(conflict?.serverDoc).toBe(serverDoc);
    await act(async () => {
      await conflict?.copyMine();
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"Mine"'));
    await act(async () => {
      await conflict?.overwrite();
    });
    expect(save.mock.calls[1]?.[1]).toMatchObject({ force: true });
    expect(result.current.conflict).toBeNull();
  });

  it('reload loads the server document', async () => {
    const serverDoc = makeDoc();
    serverDoc.root.props.title = 'Server';
    const save = vi.fn().mockRejectedValue(
      new EditorAdapterError('conflict', 'moved on', {
        serverDoc,
        serverVersion: 'v9',
      }),
    );
    const { result } = renderHook(
      () => ({ api: useEditor(), conflict: useSaveConflict() }),
      {
        wrapper: ({ children }) => (
          <Editor.Root
            schema={storeSchema}
            defaultValue={makeDoc()}
            persistence={{ save, autosave: false }}
          >
            {children}
          </Editor.Root>
        ),
      },
    );
    act(() => {
      result.current.api.update('h1', { text: 'Mine' });
    });
    await act(async () => {
      await result.current.api.save();
    });
    act(() => {
      result.current.conflict?.reload();
    });
    expect(result.current.api.getDocument().root.props.title).toBe('Server');
    expect(result.current.conflict).toBeNull();
  });
});

describe('useCommand', () => {
  it('reflects availability and runs built-ins', () => {
    const { result } = renderHook(
      () => ({ api: useEditor(), undo: useCommand('history.undo') }),
      {
        wrapper: ({ children }) => (
          <Editor.Root schema={storeSchema} defaultValue={makeDoc()}>
            {children}
          </Editor.Root>
        ),
      },
    );
    expect(result.current.undo?.canExecute).toBe(false);
    act(() => {
      result.current.api.update('h1', { text: 'x' });
    });
    expect(result.current.undo?.canExecute).toBe(true);
    act(() => {
      result.current.undo?.run();
    });
    expect(result.current.api.getDoc().nodes.h1?.props.text).toBe('Hello');
  });
});

// @vitest-environment happy-dom
import type * as React from 'react';

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from '@testing-library/react';
import { useLayoutEffect, useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorKeyboardOptions } from './keyboard';
import type { EditorStore } from './store';

import { useEditorContext } from './context';
import { Editor } from './index';
import { useEditorKeyboard } from './keyboard';
import { counterGenId, makeTree, storeSchema } from './store/fixtures';

afterEach(cleanup);

type Probe = { store: EditorStore | null };

function StoreProbe({ probe }: { probe: Probe }) {
  probe.store = useEditorContext('StoreProbe').store;
  return null;
}

function Harness({
  options,
  children,
}: {
  options?: EditorKeyboardOptions;
  children?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEditorKeyboard(ref, options);
  return (
    <div ref={ref} data-testid="scope">
      {children}
    </div>
  );
}

function mount(options?: EditorKeyboardOptions, children?: React.ReactNode) {
  const probe: Probe = { store: null };
  const utils = render(
    <Editor.Root
      schema={storeSchema}
      defaultValue={makeTree()}
      genId={counterGenId()}
    >
      <StoreProbe probe={probe} />
      <Harness options={options}>{children}</Harness>
    </Editor.Root>,
  );
  return { ...utils, probe };
}

describe('useEditorKeyboard', () => {
  it('Ctrl+Z undoes an add and Ctrl+Shift+Z redoes it', () => {
    const { getByTestId, probe } = mount();
    act(() => {
      probe.store?.add('heading', { parentId: 'root_1' });
    });
    expect(probe.store?.getState().nodes.n1).toBeDefined();
    fireEvent.keyDown(getByTestId('scope'), { key: 'z', ctrlKey: true });
    expect(probe.store?.getState().nodes.n1).toBeUndefined();
    fireEvent.keyDown(getByTestId('scope'), {
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(probe.store?.getState().nodes.n1).toBeDefined();
  });

  it('Meta+Z undoes like Ctrl+Z', () => {
    const { getByTestId, probe } = mount();
    act(() => {
      probe.store?.add('heading', { parentId: 'root_1' });
    });
    fireEvent.keyDown(getByTestId('scope'), { key: 'z', metaKey: true });
    expect(probe.store?.getState().nodes.n1).toBeUndefined();
  });

  it('Ctrl+Y redoes after an undo', () => {
    const { getByTestId, probe } = mount();
    act(() => {
      probe.store?.add('heading', { parentId: 'root_1' });
    });
    fireEvent.keyDown(getByTestId('scope'), { key: 'z', ctrlKey: true });
    expect(probe.store?.getState().nodes.n1).toBeUndefined();
    fireEvent.keyDown(getByTestId('scope'), { key: 'y', ctrlKey: true });
    expect(probe.store?.getState().nodes.n1).toBeDefined();
  });

  it('undo still runs when focus is inside an input', () => {
    const { getByTestId, probe } = mount(undefined, <input data-testid="in" />);
    act(() => {
      probe.store?.add('heading', { parentId: 'root_1' });
    });
    fireEvent.keyDown(getByTestId('in'), { key: 'z', ctrlKey: true });
    expect(probe.store?.getState().nodes.n1).toBeUndefined();
  });

  it('a consumer onKeyDown that preventDefault leaves the add in place on Ctrl+Z', () => {
    const probe: Probe = { store: null };
    function Guarded() {
      const ref = useRef<HTMLDivElement | null>(null);
      useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const guard = (event: KeyboardEvent) => {
          event.preventDefault();
        };
        el.addEventListener('keydown', guard);
        return () => el.removeEventListener('keydown', guard);
      }, []);
      useEditorKeyboard(ref);
      return <div ref={ref} data-testid="scope" />;
    }
    const { getByTestId } = render(
      <Editor.Root
        schema={storeSchema}
        defaultValue={makeTree()}
        genId={counterGenId()}
      >
        <StoreProbe probe={probe} />
        <Guarded />
      </Editor.Root>,
    );
    act(() => {
      probe.store?.add('heading', { parentId: 'root_1' });
    });
    fireEvent.keyDown(getByTestId('scope'), { key: 'z', ctrlKey: true });
    expect(probe.store?.getState().nodes.n1).toBeDefined();
  });

  it('without options, Delete on the scope with h1 selected does not remove h1', () => {
    const { getByTestId, probe } = mount();
    act(() => {
      probe.store?.select('h1');
    });
    fireEvent.keyDown(getByTestId('scope'), { key: 'Delete' });
    expect(probe.store?.getState().nodes.h1).toBeDefined();
  });

  it('with delete: true, Delete removes h1 unless the target is an input', () => {
    const { getByTestId, probe } = mount(
      { delete: true },
      <input data-testid="in" />,
    );
    act(() => {
      probe.store?.select('h1');
    });
    fireEvent.keyDown(getByTestId('in'), { key: 'Delete' });
    expect(probe.store?.getState().nodes.h1).toBeDefined();
    fireEvent.keyDown(getByTestId('scope'), { key: 'Delete' });
    expect(probe.store?.getState().nodes.h1).toBeUndefined();
  });

  it('with escape: true, Escape clears the selection unless the target is an input', () => {
    const { getByTestId, probe } = mount(
      { escape: true },
      <input data-testid="in" />,
    );
    act(() => {
      probe.store?.select('h1');
    });
    fireEvent.keyDown(getByTestId('in'), { key: 'Escape' });
    expect(probe.store?.getState().selection.local.selected).toBe('h1');
    fireEvent.keyDown(getByTestId('scope'), { key: 'Escape' });
    expect(probe.store?.getState().selection.local.selected).toBeNull();
  });

  it('throws outside Editor.Root', () => {
    expect(() =>
      renderHook(() => {
        const ref = { current: null as HTMLDivElement | null };
        useEditorKeyboard(ref);
      }),
    ).toThrow(
      'useEditorKeyboard must be used within an Editor.Root component.',
    );
  });
});

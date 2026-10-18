// @vitest-environment happy-dom
import type * as React from 'react';

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
} from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorPlugin } from './core';
import type { EditorStore } from './core/store';

import { useEditorContext } from './context';
import { counterGenId, makeDoc, storeSchema } from './core/store/fixtures';
import { Editor } from './index';
import { useEditorKeyboard } from './keyboard';

afterEach(cleanup);

type Probe = { store: EditorStore | null };

function StoreProbe({ probe }: { probe: Probe }) {
  probe.store = useEditorContext('StoreProbe').store;
  return null;
}

function Harness({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEditorKeyboard(ref);
  return (
    <div ref={ref} data-testid="scope">
      {children}
    </div>
  );
}

function mount(children?: React.ReactNode, plugins?: readonly EditorPlugin[]) {
  const probe: Probe = { store: null };
  const utils = render(
    <Editor.Root
      schema={storeSchema}
      defaultValue={makeDoc()}
      genId={counterGenId()}
      plugins={plugins}
    >
      <StoreProbe probe={probe} />
      <Harness>{children}</Harness>
    </Editor.Root>,
  );
  return { ...utils, probe };
}

describe('useEditorKeyboard', () => {
  it('Ctrl+Z undoes an add and Ctrl+Shift+Z redoes it', () => {
    const { getByTestId, probe } = mount();
    act(() => {
      probe.store?.add('heading', { parent: { id: 'root_1' } });
    });
    expect(probe.store?.getDoc().nodes.n1).toBeDefined();
    fireEvent.keyDown(getByTestId('scope'), { key: 'z', ctrlKey: true });
    expect(probe.store?.getDoc().nodes.n1).toBeUndefined();
    fireEvent.keyDown(getByTestId('scope'), {
      key: 'z',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(probe.store?.getDoc().nodes.n1).toBeDefined();
  });

  it('Meta+Z undoes like Ctrl+Z', () => {
    const { getByTestId, probe } = mount();
    act(() => {
      probe.store?.add('heading', { parent: { id: 'root_1' } });
    });
    fireEvent.keyDown(getByTestId('scope'), { key: 'z', metaKey: true });
    expect(probe.store?.getDoc().nodes.n1).toBeUndefined();
  });

  it('Ctrl+Y redoes after an undo', () => {
    const { getByTestId, probe } = mount();
    act(() => {
      probe.store?.add('heading', { parent: { id: 'root_1' } });
    });
    fireEvent.keyDown(getByTestId('scope'), { key: 'z', ctrlKey: true });
    expect(probe.store?.getDoc().nodes.n1).toBeUndefined();
    fireEvent.keyDown(getByTestId('scope'), { key: 'y', ctrlKey: true });
    expect(probe.store?.getDoc().nodes.n1).toBeDefined();
  });

  it('undo still runs when focus is inside an input', () => {
    const { getByTestId, probe } = mount(<input data-testid="in" />);
    act(() => {
      probe.store?.add('heading', { parent: { id: 'root_1' } });
    });
    fireEvent.keyDown(getByTestId('in'), { key: 'z', ctrlKey: true });
    expect(probe.store?.getDoc().nodes.n1).toBeUndefined();
  });

  it('a consumer onKeyDown that preventDefault leaves the add in place on Ctrl+Z', () => {
    const probe: Probe = { store: null };
    function Guarded() {
      const ref = useRef<HTMLDivElement | null>(null);
      useEditorKeyboard(ref);
      return (
        <div
          ref={ref}
          data-testid="scope"
          onKeyDown={(event) => event.preventDefault()}
        />
      );
    }
    const { getByTestId } = render(
      <Editor.Root
        schema={storeSchema}
        defaultValue={makeDoc()}
        genId={counterGenId()}
      >
        <StoreProbe probe={probe} />
        <Guarded />
      </Editor.Root>,
    );
    act(() => {
      probe.store?.add('heading', { parent: { id: 'root_1' } });
    });
    fireEvent.keyDown(getByTestId('scope'), { key: 'z', ctrlKey: true });
    expect(probe.store?.getDoc().nodes.n1).toBeDefined();
  });

  it('Delete removes the selected block and selects its neighbour', () => {
    const { getByTestId, probe } = mount();
    act(() => probe.store?.select('h1'));
    fireEvent.keyDown(getByTestId('scope'), { key: 'Delete' });
    expect(probe.store?.getDoc().nodes.h1).toBeUndefined();
    expect(probe.store?.getSession().selection).toEqual(['sec1']);
  });

  it('Escape walks up to the parent, then clears', () => {
    const { getByTestId, probe } = mount();
    act(() => probe.store?.select('p1'));
    fireEvent.keyDown(getByTestId('scope'), { key: 'Escape' });
    expect(probe.store?.getSession().selection).toEqual(['sec1']);
    fireEvent.keyDown(getByTestId('scope'), { key: 'Escape' });
    expect(probe.store?.getSession().selection).toEqual([]);
  });

  it('Enter, Tab, Shift+Tab and Mod+a move the selection', () => {
    const { getByTestId, probe } = mount();
    const scope = getByTestId('scope');
    act(() => probe.store?.select('h1'));
    fireEvent.keyDown(scope, { key: 'Tab' });
    expect(probe.store?.getSession().selection).toEqual(['sec1']);
    fireEvent.keyDown(scope, { key: 'Enter' });
    expect(probe.store?.getSession().selection).toEqual(['p1']);
    fireEvent.keyDown(scope, { key: 'Enter', shiftKey: true });
    expect(probe.store?.getSession().selection).toEqual(['sec1']);
    fireEvent.keyDown(scope, { key: 'Tab', shiftKey: true });
    expect(probe.store?.getSession().selection).toEqual(['h1']);
    fireEvent.keyDown(scope, { key: 'a', ctrlKey: true });
    expect(probe.store?.getSession().selection).toEqual(['h1', 'sec1']);
  });

  it('Tab with nothing to select next leaves the key to the browser', () => {
    const { getByTestId, probe } = mount();
    act(() => probe.store?.select('sec1'));
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    getByTestId('scope').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('Mod+d duplicates and Alt+Arrow moves', () => {
    const { getByTestId, probe } = mount();
    const scope = getByTestId('scope');
    act(() => probe.store?.select('h1'));
    fireEvent.keyDown(scope, { key: 'ArrowDown', altKey: true });
    const root = () => probe.store?.getDoc().nodes.root_1?.slots.children;
    expect(root()).toEqual(['sec1', 'h1']);
    fireEvent.keyDown(scope, { key: 'd', metaKey: true });
    expect(root()).toHaveLength(3);
    expect(probe.store?.getSession().selection[0]).not.toBe('h1');
  });

  it.each([
    ['input', <input key="t" data-testid="target" />],
    ['textarea', <textarea key="t" data-testid="target" />],
    ['contenteditable', <div key="t" data-testid="target" contentEditable />],
    ['button', <button key="t" data-testid="target" type="button" />],
    [
      'treeitem',
      <div key="t" data-testid="target" role="treeitem" tabIndex={0} />,
    ],
  ])('plain keys never fire from a focused %s', (_, target) => {
    const { getByTestId, probe } = mount(target);
    act(() => probe.store?.select('sec1'));
    for (const key of ['Delete', 'Backspace', 'Escape', 'Enter', 'Tab', '/']) {
      fireEvent.keyDown(getByTestId('target'), { key });
    }
    expect(probe.store?.getDoc().nodes.sec1).toBeDefined();
    expect(probe.store?.getSession().selection).toEqual(['sec1']);
  });

  it('Mod+d does not fire in an input, but does from a button', () => {
    const { getByTestId, probe } = mount(
      <>
        <input data-testid="in" />
        <button data-testid="btn" type="button" />
      </>,
    );
    act(() => probe.store?.select('h1'));
    const count = () => probe.store?.getDoc().nodes.root_1?.slots.children;
    fireEvent.keyDown(getByTestId('in'), { key: 'd', ctrlKey: true });
    expect(count()).toHaveLength(2);
    fireEvent.keyDown(getByTestId('btn'), { key: 'd', ctrlKey: true });
    expect(count()).toHaveLength(3);
  });

  it('keys during an IME composition never fire', () => {
    const { getByTestId, probe } = mount();
    act(() => probe.store?.select('h1'));
    fireEvent.keyDown(getByTestId('scope'), {
      key: 'Delete',
      isComposing: true,
    });
    expect(probe.store?.getDoc().nodes.h1).toBeDefined();
  });

  it('ui commands emit the ui event', () => {
    const { getByTestId, probe } = mount();
    const actions: string[] = [];
    probe.store?.on('ui', (event) => actions.push(event.action));
    const scope = getByTestId('scope');
    fireEvent.keyDown(scope, { key: 'k', metaKey: true });
    fireEvent.keyDown(scope, { key: '/' });
    fireEvent.keyDown(scope, { key: 'F10', altKey: true });
    fireEvent.keyDown(scope, { key: '?', shiftKey: true });
    expect(actions).toEqual([
      'commandPalette',
      'quickInsert',
      'toolbar',
      'shortcutHelp',
    ]);
  });

  it('a plugin rebinds and unbinds default combos', () => {
    const { getByTestId, probe } = mount(undefined, [
      { name: 'keys', shortcuts: { Delete: '', 'Mod+d': 'history.undo' } },
    ]);
    act(() => probe.store?.select('h1'));
    fireEvent.keyDown(getByTestId('scope'), { key: 'Delete' });
    expect(probe.store?.getDoc().nodes.h1).toBeDefined();
    expect(probe.store?.commands.shortcuts()['mod+d']).toBe('history.undo');
    expect(probe.store?.commands.shortcuts()['mod+shift+d']).toBe(
      'block.duplicate',
    );
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

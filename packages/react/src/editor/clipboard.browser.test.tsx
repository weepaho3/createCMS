import type * as React from 'react';

import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorStore } from './core/store';

import { useEditorContext } from './context';
import { CLIPBOARD_ATTRIBUTE } from './core/clipboard';
import { counterGenId, makeDoc, storeSchema } from './core/store/fixtures';
import { Editor } from './index';
import { useEditorKeyboard } from './keyboard';

afterEach(cleanup);

type Probe = { store: EditorStore | null };

function StoreProbe({ probe }: { probe: Probe }) {
  probe.store = useEditorContext('StoreProbe').store;
  return null;
}

function Scope({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEditorKeyboard(ref);
  return (
    <div ref={ref} data-testid="scope">
      <button type="button" data-testid="focus">
        Block
      </button>
      {children}
    </div>
  );
}

function mount(children?: React.ReactNode) {
  const probe: Probe = { store: null };
  const utils = render(
    <Editor.Root
      schema={storeSchema}
      defaultValue={makeDoc()}
      genId={counterGenId()}
    >
      <StoreProbe probe={probe} />
      <Scope>{children}</Scope>
    </Editor.Root>,
  );
  if (!probe.store) throw new Error('store probe did not mount');
  return { ...utils, store: probe.store };
}

/** A real `ClipboardEvent` carrying a real `DataTransfer`. */
function clipboardEvent(
  target: EventTarget,
  type: 'copy' | 'cut' | 'paste',
  data = new DataTransfer(),
): { event: ClipboardEvent; data: DataTransfer } {
  const event = new ClipboardEvent(type, {
    bubbles: true,
    cancelable: true,
    clipboardData: data,
  });
  // Firefox swaps the init `clipboardData` for an empty `DataTransfer`.
  if (event.clipboardData !== data) {
    Object.defineProperty(event, 'clipboardData', { value: data });
  }
  act(() => {
    target.dispatchEvent(event);
  });
  return { event, data };
}

function rootChildren(store: EditorStore): readonly string[] {
  const { nodes, rootId } = store.getDoc();
  return nodes[rootId]?.slots.children ?? [];
}

describe('block clipboard in a real browser', () => {
  it('copy writes the payload as text/html and the text as text/plain', () => {
    const { getByTestId, store } = mount();
    act(() => store.select('h1'));
    getByTestId('focus').focus();
    const { event, data } = clipboardEvent(getByTestId('focus'), 'copy');
    expect(event.defaultPrevented).toBe(true);
    expect(data.getData('text/plain')).toBe('Hello');
    expect(data.getData('text/html')).toContain(CLIPBOARD_ATTRIBUTE);
    expect(store.getDoc().nodes.h1).toBeDefined();
  });

  it('paste of a copied block inserts a fresh copy after the selection', () => {
    const { getByTestId, store } = mount();
    act(() => store.select('h1'));
    const target = getByTestId('focus');
    target.focus();
    const { data } = clipboardEvent(target, 'copy');
    const pasted = new DataTransfer();
    pasted.setData('text/html', data.getData('text/html'));
    pasted.setData('text/plain', data.getData('text/plain'));
    const { event } = clipboardEvent(target, 'paste', pasted);
    expect(event.defaultPrevented).toBe(true);
    const children = rootChildren(store);
    expect(children).toHaveLength(3);
    expect(children[0]).toBe('h1');
    const copyId = children[1]!;
    expect(copyId).not.toBe('h1');
    expect(store.getDoc().nodes[copyId]?.props.text).toBe('Hello');
    expect(store.getSession().selection).toEqual([copyId]);
  });

  it('cut copies the block and removes it', () => {
    const { getByTestId, store } = mount();
    act(() => store.select('h1'));
    getByTestId('focus').focus();
    const { event, data } = clipboardEvent(getByTestId('focus'), 'cut');
    expect(event.defaultPrevented).toBe(true);
    expect(data.getData('text/html')).toContain(CLIPBOARD_ATTRIBUTE);
    expect(store.getDoc().nodes.h1).toBeUndefined();
  });

  it('copy and paste inside an input stay with the browser', () => {
    const { getByTestId, store } = mount(<input data-testid="input" />);
    act(() => store.select('h1'));
    const input = getByTestId('input');
    input.focus();
    expect(clipboardEvent(input, 'copy').event.defaultPrevented).toBe(false);
    const pasted = new DataTransfer();
    pasted.setData('text/plain', 'typed');
    expect(clipboardEvent(input, 'paste', pasted).event.defaultPrevented).toBe(
      false,
    );
    expect(rootChildren(store)).toHaveLength(2);
  });

  it('copy of selected text stays with the browser', () => {
    const { getByTestId, store } = mount(<p data-testid="text">Some text</p>);
    act(() => store.select('h1'));
    const text = getByTestId('text');
    const selection = document.getSelection()!;
    selection.selectAllChildren(text);
    const { event } = clipboardEvent(text, 'copy');
    selection.removeAllRanges();
    expect(event.defaultPrevented).toBe(false);
  });

  it('foreign text/plain without a plugin is left alone', () => {
    const { getByTestId, store } = mount();
    act(() => store.select('h1'));
    const target = getByTestId('focus');
    target.focus();
    const pasted = new DataTransfer();
    pasted.setData('text/plain', 'from elsewhere');
    expect(clipboardEvent(target, 'paste', pasted).event.defaultPrevented).toBe(
      false,
    );
    expect(rootChildren(store)).toHaveLength(2);
  });
});

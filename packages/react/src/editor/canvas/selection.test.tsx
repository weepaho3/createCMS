// @vitest-environment happy-dom
import { act, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { createEditorStore } from '../core/store';
import { counterGenId, makeDoc, storeSchema } from '../core/store/fixtures';
import { Canvas } from './index';
import { depthParent, rangeSelection, toggledSelection } from './interact';
import { renderCanvas } from './test/harness';

afterEach(cleanup);

const makeStore = () =>
  createEditorStore({
    schema: storeSchema,
    initialValue: makeDoc(),
    genId: counterGenId(),
  });

describe('selection helpers', () => {
  it('rangeSelection spans siblings from the anchor, primary first', () => {
    const store = makeStore();
    store.select('sec1');
    expect(rangeSelection(store, 'h1')).toEqual(['sec1', 'h1']);
    store.select('h1');
    // p1 sits inside sec1: the range ends at its ancestor in h1's slot.
    expect(rangeSelection(store, 'p1')).toEqual(['h1', 'sec1']);
    store.select('p1');
    expect(rangeSelection(store, 'h1')).toEqual(['h1']);
  });

  it('toggledSelection adds and removes', () => {
    const store = makeStore();
    store.select('h1');
    expect(toggledSelection(store, 'sec1')).toEqual(['h1', 'sec1']);
    store.setSelection(['h1', 'sec1']);
    expect(toggledSelection(store, 'h1')).toEqual(['sec1']);
  });

  it('depthParent climbs one level per repeat', () => {
    const store = makeStore();
    expect(depthParent(store, 'p1')).toBe('sec1');
    store.select('sec1');
    expect(depthParent(store, 'p1')).toBeNull();
  });
});

describe('canvas clicks', () => {
  const block = (host: HTMLElement, id: string) =>
    host.querySelector<HTMLElement>(`[data-editor-block="${id}"]`)!;

  it('Shift+click selects a range, Mod+click toggles, Alt+click picks the parent', () => {
    const { host, store } = renderCanvas();
    act(() => store.select('h1'));
    fireEvent.click(block(host, 'p1'), { shiftKey: true });
    expect(store.getSession().selection).toEqual(['h1', 'sec1']);
    fireEvent.click(block(host, 'h1'), { metaKey: true });
    expect(store.getSession().selection).toEqual(['sec1']);
    act(() => store.select(null));
    fireEvent.click(block(host, 'p1'), { altKey: true });
    expect(store.getSession().selection).toEqual(['sec1']);
    expect(store.getSession().editing).toBeNull();
  });

  it('select-first: the first tap selects, a tap on the selected block edits', () => {
    const { host, store } = renderCanvas(<Canvas.InlineText />, {
      clickToEdit: 'select-first',
    });
    const field = host.querySelector<HTMLElement>(
      '[data-editor-block="h1"] [data-editor-field="text"]',
    )!;
    fireEvent.pointerDown(field);
    fireEvent.click(field);
    expect(store.getSession().selection).toEqual(['h1']);
    expect(store.getSession().editing).toBeNull();
    fireEvent.pointerDown(field);
    fireEvent.click(field);
    expect(store.getSession().editing).toEqual({ blockId: 'h1', key: 'text' });
  });

  it('the canvas host sets touch-action: manipulation', () => {
    const { host } = renderCanvas();
    expect(host.style.touchAction).toBe('manipulation');
  });
});

describe('Canvas.ContextMenu', () => {
  it('right click selects the block and lists commands and every ancestor', () => {
    const { host, store } = renderCanvas(<Canvas.ContextMenu />);
    fireEvent.contextMenu(host.querySelector('[data-editor-block="p1"]')!, {
      clientX: 10,
      clientY: 10,
    });
    expect(store.getSession().selection).toEqual(['p1']);
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.getAttribute('aria-label')).toBe('Block actions');
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toContain('Duplicate');
    const ancestor = menu.querySelector<HTMLElement>(
      '[data-select="ancestor"]',
    )!;
    expect(ancestor.textContent).toBe('Select Section "Sec"');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.click(ancestor);
    expect(store.getSession().selection).toEqual(['sec1']);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('runs a command and closes on Escape', () => {
    const { host, store } = renderCanvas(<Canvas.ContextMenu />);
    const open = () =>
      fireEvent.contextMenu(host.querySelector('[data-editor-block="h1"]')!);
    open();
    fireEvent.click(
      document.querySelector('[data-command="block.duplicate"]')!,
    );
    expect(store.getDoc().nodes.root_1!.slots.children).toHaveLength(3);
    open();
    fireEvent.keyDown(document.querySelector('[role="menu"]')!, {
      key: 'Escape',
    });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});

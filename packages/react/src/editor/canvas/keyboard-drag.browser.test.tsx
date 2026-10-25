import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Editor } from '../index';
import { Canvas } from './index';
import { renderCanvas, waitForLayout } from './test/harness';

afterEach(cleanup);

function mount() {
  const utils = renderCanvas(
    <>
      <Editor.LiveAnnouncer data-testid="live" />
      <Canvas.Overlay>
        <Canvas.DropIndicator />
        <Canvas.DragHandle blockId="h1">grip</Canvas.DragHandle>
      </Canvas.Overlay>
    </>,
  );
  return utils;
}

const live = () =>
  document.querySelector('[data-editor-live-announcer]')?.textContent ?? '';

describe('keyboard drag on Canvas.DragHandle', () => {
  it('moves a block into another container with the keyboard only, announcing each step', async () => {
    const { host, store } = mount();
    await waitForLayout(host.querySelector('[data-editor-block="p1"]')!);
    const handle = host.querySelector<HTMLElement>(
      '[data-editor-drag-handle]',
    )!;
    handle.focus();
    fireEvent.keyDown(handle, { key: ' ' });
    await waitFor(() => expect(live()).toContain('picked up'));
    expect(host.querySelector('[data-editor-drop-indicator]')).not.toBeNull();
    // (root,0) -> (sec1,0)
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    await waitFor(() => expect(live()).toContain('position 1 of 2'));
    fireEvent.keyDown(handle, { key: 'Enter' });
    await waitFor(() => expect(live()).toContain('dropped'));
    expect(store.getDoc().nodes.sec1!.slots.children).toEqual(['h1', 'p1']);
    expect(document.activeElement).toBe(handle);
  });

  it('Escape puts the block back and announces it', async () => {
    const { host, store } = mount();
    await waitForLayout(host.querySelector('[data-editor-block="p1"]')!);
    const handle = host.querySelector<HTMLElement>(
      '[data-editor-drag-handle]',
    )!;
    handle.focus();
    fireEvent.keyDown(handle, { key: ' ' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    fireEvent.keyDown(handle, { key: 'Escape' });
    await waitFor(() => expect(live()).toContain('Cancelled'));
    expect(store.getDoc().nodes.root_1!.slots.children).toEqual(['h1', 'sec1']);
    expect(host.querySelector('[data-editor-drop-indicator]')).toBeNull();
  });
});

describe('non-drag alternatives on the handle', () => {
  it('a click opens the menu; Move down moves the block', async () => {
    const { host, store } = mount();
    const handle = host.querySelector<HTMLElement>(
      '[data-editor-drag-handle]',
    )!;
    expect(handle.getAttribute('aria-haspopup')).toBe('menu');
    act(() => handle.click());
    const menu = host.querySelector('[role="menu"]')!;
    expect(menu).not.toBeNull();
    expect(handle.getAttribute('aria-expanded')).toBe('true');
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toEqual([
      'Move up',
      'Move down',
      'Move to...',
      'Duplicate',
      'Delete',
    ]);
    expect(document.activeElement).toBe(items[1]);
    act(() => (items[1] as HTMLElement).click());
    expect(store.getDoc().nodes.root_1!.slots.children).toEqual(['sec1', 'h1']);
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it('Move to... picks a slot, then a position', async () => {
    const { host, store } = mount();
    const handle = host.querySelector<HTMLElement>(
      '[data-editor-drag-handle]',
    )!;
    act(() => handle.click());
    const moveTo = [...host.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent === 'Move to...',
    ) as HTMLElement;
    act(() => moveTo.click());
    const dialog = host.querySelector('[role="dialog"]')!;
    const slots = [...dialog.querySelectorAll('button')];
    expect(slots.map((button) => button.textContent)).toEqual([
      'the page',
      'Section "Sec"',
    ]);
    act(() => slots[1]!.click());
    const positions = [
      ...host.querySelector('[role="dialog"]')!.querySelectorAll('li button'),
    ];
    expect(positions.map((button) => button.textContent)).toEqual([
      'Position 1 of 2',
      'Position 2 of 2',
    ]);
    act(() => (positions[1] as HTMLElement).click());
    expect(store.getDoc().nodes.sec1!.slots.children).toEqual(['p1', 'h1']);
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});

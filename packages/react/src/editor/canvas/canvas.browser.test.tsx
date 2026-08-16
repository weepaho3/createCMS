import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CANVAS_HOST,
  dispatchPointer,
  rectClose,
  rectOf,
  renderCanvas,
  waitForLayout,
} from './test/harness';

afterEach(cleanup);

describe('Canvas in a real browser', () => {
  it('canvas host has a real layout box', () => {
    const { host } = renderCanvas();
    expect(host.getAttribute('data-editor-canvas')).toBe('');
    expect(
      rectClose(rectOf(host), {
        width: CANVAS_HOST.width,
        height: CANVAS_HOST.height,
      }),
    ).toBe(true);
  });

  it('heading anchor rect is measurable', () => {
    const { host } = renderCanvas();
    const block = host.querySelector('[data-editor-block="h1"]');
    const field = host.querySelector('[data-editor-field="text"]');
    expect(block).not.toBeNull();
    expect(field).not.toBeNull();
    expect(rectClose(rectOf(field!), { width: 200, height: 40 })).toBe(true);
  });

  it('waitForLayout sees a size change', async () => {
    const { host } = renderCanvas();
    const before = rectOf(host).width;
    host.style.width = '400px';
    await waitForLayout(host);
    expect(rectClose(rectOf(host), { width: 400 })).toBe(true);
    expect(rectOf(host).width).not.toBe(before);
  });

  it('dispatchPointer delivers client coordinates', () => {
    const { host } = renderCanvas();
    const field = host.querySelector('[data-editor-field="text"]');
    expect(field).not.toBeNull();
    const rect = rectOf(field!);
    const point = { x: rect.x + 10, y: rect.y + 10 };
    let clientX: number | undefined;
    let clientY: number | undefined;
    field!.addEventListener(
      'pointerdown',
      (event) => {
        const pointer = event as PointerEvent;
        clientX = pointer.clientX;
        clientY = pointer.clientY;
      },
      true,
    );
    dispatchPointer(field!, 'pointerdown', point);
    expect(clientX).toBe(point.x);
    expect(clientY).toBe(point.y);
  });

  it('click writes select and focus on heading', () => {
    const { host, store } = renderCanvas();
    const field = host.querySelector('[data-editor-field="text"]');
    expect(field).not.toBeNull();
    field!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    const local = store.getState().selection.local;
    expect(local?.selected).toBe('h1');
    expect(local?.focus).toEqual({ blockId: 'h1', key: 'text' });
  });

  it('select mode selects and does not set data-dragging', () => {
    const { host, store } = renderCanvas(undefined, { interactive: 'select' });
    const field = host.querySelector('[data-editor-field="text"]');
    expect(field).not.toBeNull();
    field!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(store.getState().selection.local?.selected).toBe('h1');
    expect(host.hasAttribute('data-dragging')).toBe(false);
    const rect = rectOf(field!);
    dispatchPointer(field!, 'pointerdown', { x: rect.x + 5, y: rect.y + 5 });
    dispatchPointer(field!, 'pointermove', { x: rect.x + 25, y: rect.y + 5 });
    expect(host.hasAttribute('data-dragging')).toBe(false);
  });

  it('none mode does not select and still intercepts links', () => {
    const { host, store } = renderCanvas(<a href="https://example.com">Go</a>, {
      interactive: 'none',
    });
    const field = host.querySelector('[data-editor-field="text"]');
    expect(field).not.toBeNull();
    field!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(store.getState().selection.local?.selected).toBeNull();
    const link = host.querySelector('a');
    expect(link).not.toBeNull();
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

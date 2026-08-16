import { cleanup } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { Measurer } from './measurer';

import { useCanvasContext } from './context';
import { Canvas } from './index';
import {
  nestedTextBlocks,
  nestedTextSchema,
  nestedTextTree,
  unionBlocks,
  unionSchema,
  unionTree,
} from './test/fixtures';
import {
  CANVAS_HOST,
  dispatchPointer,
  rectClose,
  rectOf,
  renderCanvas,
  waitForLayout,
} from './test/harness';

afterEach(cleanup);

function VersionProbe({
  onMeasurer,
}: {
  onMeasurer: (measurer: Measurer) => void;
}) {
  const ctx = useCanvasContext('VersionProbe');
  React.useLayoutEffect(() => {
    if (ctx.measurer) onMeasurer(ctx.measurer);
  }, [ctx.measurer, onMeasurer]);
  return null;
}

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

describe('Canvas overlay rings', () => {
  it('SelectionRing matches the heading block gBCR', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.SelectionRing />
      </Canvas.Overlay>,
    );
    store.select('h1');
    const block = host.querySelector('[data-editor-block="h1"]');
    expect(block).not.toBeNull();
    await waitForLayout(block!);
    const ring = host.querySelector('[data-editor-selection-ring]');
    expect(ring).not.toBeNull();
    expect(rectClose(rectOf(ring!), rectOf(block!))).toBe(true);
  });

  it('SelectionRing stays aligned after resize', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.SelectionRing />
      </Canvas.Overlay>,
    );
    store.select('h1');
    host.style.width = '400px';
    await waitForLayout(host);
    const block = host.querySelector('[data-editor-block="h1"]');
    const ring = host.querySelector('[data-editor-selection-ring]');
    expect(block).not.toBeNull();
    expect(ring).not.toBeNull();
    expect(rectClose(rectOf(ring!), rectOf(block!))).toBe(true);
  });

  it('scroll does not bump measurer version and keeps the ring aligned', async () => {
    let measurer: Measurer | null = null;
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.SelectionRing />
        <VersionProbe
          onMeasurer={(next) => {
            measurer = next;
          }}
        />
      </Canvas.Overlay>,
    );
    store.select('h1');
    host.style.height = '80px';
    await waitForLayout(host);
    expect(measurer).not.toBeNull();
    const before = measurer!.getVersion();
    host.scrollTop = 40;
    await waitForLayout(host);
    expect(measurer!.getVersion()).toBe(before);
    const block = host.querySelector('[data-editor-block="h1"]');
    const ring = host.querySelector('[data-editor-selection-ring]');
    expect(block).not.toBeNull();
    expect(ring).not.toBeNull();
    expect(rectClose(rectOf(ring!), rectOf(block!))).toBe(true);
  });

  it('FieldRing matches the outer field when nested blocks share a key', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.FieldRing />
      </Canvas.Overlay>,
      {
        schema: nestedTextSchema,
        tree: nestedTextTree(),
        components: nestedTextBlocks,
      },
    );
    store.focus({ blockId: 'outer1', key: 'text' });
    const outerField = host.querySelector(
      '[data-editor-block="outer1"] > [data-editor-field="text"]',
    );
    expect(outerField).not.toBeNull();
    await waitForLayout(outerField!);
    const ring = host.querySelector('[data-editor-field-ring]');
    expect(ring).not.toBeNull();
    expect(rectClose(rectOf(ring!), rectOf(outerField!))).toBe(true);
  });

  it('SelectionRing matches the union of same-id sibling boxes', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.SelectionRing />
      </Canvas.Overlay>,
      {
        schema: unionSchema,
        tree: unionTree(),
        components: unionBlocks,
      },
    );
    store.select('pair1');
    const boxes = host.querySelectorAll('[data-editor-block="pair1"]');
    expect(boxes.length).toBe(2);
    await waitForLayout(boxes[0]!);
    const a = rectOf(boxes[0]!);
    const b = rectOf(boxes[1]!);
    const left = Math.min(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const union = {
      x: left,
      y: top,
      width: Math.max(a.x + a.width, b.x + b.width) - left,
      height: Math.max(a.y + a.height, b.y + b.height) - top,
    };
    const ring = host.querySelector('[data-editor-selection-ring]');
    expect(ring).not.toBeNull();
    expect(rectClose(rectOf(ring!), union)).toBe(true);
  });
});

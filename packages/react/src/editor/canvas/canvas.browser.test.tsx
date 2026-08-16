import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Heading, testEdit } from './test/fixtures';
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
    const { host } = renderCanvas(null);
    expect(host.getAttribute('data-editor-canvas')).toBe('');
    expect(
      rectClose(rectOf(host), {
        width: CANVAS_HOST.width,
        height: CANVAS_HOST.height,
      }),
    ).toBe(true);
  });

  it('heading anchor rect is measurable', () => {
    const { host } = renderCanvas(
      <Heading
        properties={{ text: 'Hello', level: 1 }}
        edit={testEdit('h1', ['text'])}
      />,
    );
    const block = host.querySelector('[data-editor-block="h1"]');
    const field = host.querySelector('[data-editor-field="text"]');
    expect(block).not.toBeNull();
    expect(field).not.toBeNull();
    expect(rectClose(rectOf(field!), { width: 200, height: 40 })).toBe(true);
  });

  it('waitForLayout sees a size change', async () => {
    const { host } = renderCanvas(null);
    const before = rectOf(host).width;
    host.style.width = '400px';
    await waitForLayout(host);
    expect(rectClose(rectOf(host), { width: 400 })).toBe(true);
    expect(rectOf(host).width).not.toBe(before);
  });

  it('dispatchPointer delivers client coordinates', () => {
    const { host } = renderCanvas(
      <Heading
        properties={{ text: 'Hello', level: 1 }}
        edit={testEdit('h1', ['text'])}
      />,
    );
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
});

import type { ReactNode } from 'react';

import { render, type RenderResult } from '@testing-library/react';

import { Editor } from '../../index';
import { makeTree, storeSchema } from '../../store/fixtures';
import { Canvas } from '../index';

export const CANVAS_HOST = { width: 800, height: 600 } as const;

export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/** True when each provided field is within `epsilon` CSS pixels. */
export function rectClose(
  actual: Rect,
  expected: Partial<Rect>,
  epsilon = 1,
): boolean {
  const keys = ['x', 'y', 'width', 'height'] as const;
  for (const key of keys) {
    const want = expected[key];
    if (want === undefined) continue;
    if (Math.abs(actual[key] - want) > epsilon) return false;
  }
  return true;
}

export type RenderCanvasOptions = {
  schema?: typeof storeSchema;
  tree?: ReturnType<typeof makeTree>;
};

export function renderCanvas(
  children: ReactNode,
  options?: RenderCanvasOptions,
): RenderResult & { host: HTMLElement } {
  const utils = render(
    <Editor.Root
      schema={options?.schema ?? storeSchema}
      defaultValue={options?.tree ?? makeTree()}
    >
      <Canvas.Root
        data-testid="canvas"
        style={{
          position: 'relative',
          boxSizing: 'border-box',
          width: CANVAS_HOST.width,
          height: CANVAS_HOST.height,
          overflow: 'auto',
        }}
      >
        {children}
      </Canvas.Root>
    </Editor.Root>,
  );
  const host = utils.getByTestId('canvas');
  return { ...utils, host };
}

export function waitForLayout(element: Element): Promise<DOMRect> {
  return new Promise((resolve) => {
    let settled = false;
    const observer = new ResizeObserver(() => {
      settle();
    });
    const settle = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      resolve(element.getBoundingClientRect());
    };
    observer.observe(element);
    // ResizeObserver does not fire when the size did not change; the
    // double frame covers that path.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        settle();
      });
    });
  });
}

export type Point = { x: number; y: number };

export function dispatchPointer(
  target: EventTarget,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  point: Point,
  init?: PointerEventInit,
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      pointerId: 1,
      pointerType: 'mouse',
      ...init,
    }),
  );
}

export function pointerDrag(target: EventTarget, from: Point, to: Point): void {
  dispatchPointer(target, 'pointerdown', from);
  dispatchPointer(target, 'pointermove', to);
  dispatchPointer(target, 'pointerup', to);
}

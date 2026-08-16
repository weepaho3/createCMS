import type { BlockTreeNode } from '@createcms/schema';
import type { ReactNode } from 'react';

import { render, type RenderResult } from '@testing-library/react';

import type { AnyEditorSchema } from '../../schema';
import type { EditorStore } from '../../store';
import type { CanvasInteractive } from '../components';
import type { CanvasComponents } from '../map';
import type { CanvasResolve } from '../resolve';

import { Editor, useEditorContext } from '../../index';
import { makeTree, storeSchema } from '../../store/fixtures';
import { Canvas } from '../index';
import { canvasBlocks } from './fixtures';

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
  schema?: AnyEditorSchema;
  tree?: BlockTreeNode;
  components?: CanvasComponents;
  interactive?: CanvasInteractive;
  resolve?: CanvasResolve;
};

type StoreProbeBag = { store: EditorStore | null };

function StoreProbe({ probe }: { probe: StoreProbeBag }) {
  probe.store = useEditorContext('StoreProbe').store;
  return null;
}

export function renderCanvas(
  overlayChildren?: ReactNode,
  options?: RenderCanvasOptions,
): RenderResult & { host: HTMLElement; store: EditorStore } {
  const probe: StoreProbeBag = { store: null };
  const utils = render(
    <Editor.Root
      schema={options?.schema ?? storeSchema}
      defaultValue={options?.tree ?? makeTree()}
    >
      <StoreProbe probe={probe} />
      <Canvas.Root
        data-testid="canvas"
        components={options?.components ?? canvasBlocks}
        interactive={options?.interactive}
        resolve={options?.resolve}
        style={{
          position: 'relative',
          boxSizing: 'border-box',
          width: CANVAS_HOST.width,
          height: CANVAS_HOST.height,
          overflow: 'auto',
        }}
      >
        {overlayChildren}
      </Canvas.Root>
    </Editor.Root>,
  );
  if (!probe.store) throw new Error('store probe did not mount');
  const host = utils.getByTestId('canvas');
  return { ...utils, host, store: probe.store };
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

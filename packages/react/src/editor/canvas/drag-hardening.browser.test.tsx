import { act, cleanup } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditProps } from '../core/edit';
import type { CanvasComponents } from './map';

import { Canvas } from './index';
import {
  columnStackBlocks,
  columnStackTree,
  insertStackSchema,
} from './test/fixtures';
import {
  dispatchPointer,
  rectOf,
  renderCanvas,
  waitForLayout,
} from './test/harness';

afterEach(cleanup);

const center = (rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

function sixCells() {
  const tree = columnStackTree();
  const stack = tree.root.slots!.children![0]!;
  for (let i = 4; i <= 6; i++) {
    stack.slots!.children!.push({
      id: `c${i}`,
      type: 'cell',
      props: { text: String(i) },
    });
  }
  return tree;
}

function TallStack({
  edit,
  children,
}: {
  edit: EditProps;
  children?: React.ReactNode;
}) {
  return (
    <div
      {...edit.block}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 80,
        height: 300,
      }}
    >
      {children}
    </div>
  );
}

describe('hardened pointer drags', () => {
  it('a multi-selection drag lands every block in order, undone in one step', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DragHandle blockId="c1">grip</Canvas.DragHandle>
      </Canvas.Overlay>,
      {
        schema: insertStackSchema,
        tree: sixCells(),
        components: columnStackBlocks,
      },
    );
    const c6 = host.querySelector('[data-editor-block="c6"]')!;
    await waitForLayout(c6);
    act(() => store.setSelection(['c1', 'c3', 'c5']));
    await waitForLayout(host);
    const handle = host.querySelector('[data-editor-drag-handle]')!;
    const from = center(handle.getBoundingClientRect());
    const r6 = rectOf(c6);
    const to = { x: r6.x + r6.width / 2, y: r6.y + r6.height - 2 };
    dispatchPointer(handle, 'pointerdown', from);
    dispatchPointer(handle, 'pointermove', { x: from.x + 6, y: from.y + 6 });
    expect(
      host.querySelectorAll('[data-dragging]').length,
    ).toBeGreaterThanOrEqual(3);
    dispatchPointer(handle, 'pointermove', to);
    dispatchPointer(handle, 'pointerup', to);
    const children = () => store.getDoc().nodes.stack1!.slots.children;
    expect(children()).toEqual(['c2', 'c4', 'c6', 'c1', 'c3', 'c5']);
    expect(host.querySelector('[data-dragging]')).toBeNull();
    act(() => {
      store.undo();
    });
    expect(children()).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
  });

  it('the edge band of a tall container drops after it, not into it', async () => {
    const tree = columnStackTree();
    tree.root.slots!.children!.push({
      id: 'after',
      type: 'cell',
      props: { text: 'a' },
    });
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.PaletteItem type="cell">Cell</Canvas.PaletteItem>
        <Canvas.DropIndicator />
      </Canvas.Overlay>,
      {
        schema: insertStackSchema,
        tree,
        components: {
          ...columnStackBlocks,
          stack: TallStack,
        } as CanvasComponents,
        style: { height: 500 },
      },
    );
    const stack = host.querySelector('[data-editor-block="stack1"]')!;
    await waitForLayout(stack);
    const palette = host.querySelector('[data-editor-palette-item]')!;
    const from = center(palette.getBoundingClientRect());
    const r = rectOf(stack);
    const nearBottom = { x: r.x + r.width / 2, y: r.y + r.height - 10 };
    dispatchPointer(palette, 'pointerdown', from);
    dispatchPointer(palette, 'pointermove', { x: from.x + 6, y: from.y });
    dispatchPointer(palette, 'pointermove', nearBottom);
    dispatchPointer(palette, 'pointerup', nearBottom);
    const rootChildren =
      store.getDoc().nodes[store.getDoc().rootId]!.slots.children;
    expect(rootChildren.length).toBe(3);
    expect(rootChildren[0]).toBe('stack1');
    expect(store.getDoc().nodes.stack1!.slots.children).toHaveLength(3);
  });

  it('jitter of 3 px around a gap keeps the drop target', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.PaletteItem type="cell">Cell</Canvas.PaletteItem>
        <Canvas.DropIndicator />
      </Canvas.Overlay>,
      {
        schema: insertStackSchema,
        tree: columnStackTree(),
        components: columnStackBlocks,
      },
    );
    const c1 = host.querySelector('[data-editor-block="c1"]')!;
    const c2 = host.querySelector('[data-editor-block="c2"]')!;
    await waitForLayout(c2);
    const palette = host.querySelector('[data-editor-palette-item]')!;
    const from = center(palette.getBoundingClientRect());
    const gapY = rectOf(c2).y;
    const x = rectOf(c1).x + 20;
    dispatchPointer(palette, 'pointerdown', from);
    dispatchPointer(palette, 'pointermove', { x: from.x + 6, y: from.y });
    dispatchPointer(palette, 'pointermove', { x, y: gapY - 1 });
    const indicator = () =>
      host
        .querySelector('[data-editor-drop-indicator]')
        ?.getBoundingClientRect().y;
    await waitForLayout(host);
    const held = indicator();
    for (const dy of [3, -3, 2, -2, 3]) {
      dispatchPointer(palette, 'pointermove', { x, y: gapY - 1 + dy });
      await waitForLayout(host);
      expect(indicator()).toBe(held);
    }
    dispatchPointer(palette, 'pointerup', { x, y: gapY - 1 });
    expect(store.getDoc().nodes.stack1!.slots.children).toHaveLength(4);
  });
});

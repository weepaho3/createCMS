import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Canvas } from './index';
import {
  columnStackBlocks,
  columnStackTree,
  emptyStackBlocks,
  emptyStackTree,
  insertStackSchema,
  nestedOnlyStackSchema,
  rowStackBlocks,
  rowStackTree,
} from './test/fixtures';
import {
  dispatchPointer,
  rectOf,
  renderCanvas,
  waitForLayout,
  type Point,
} from './test/harness';

afterEach(cleanup);

function stackOptions(
  components: typeof columnStackBlocks,
  tree: ReturnType<typeof columnStackTree>,
) {
  return {
    schema: insertStackSchema,
    tree,
    components,
  };
}

function dragPastThreshold(
  target: EventTarget,
  from: Point,
  to: Point,
  init?: PointerEventInit,
): void {
  dispatchPointer(target, 'pointerdown', from, init);
  dispatchPointer(
    target,
    'pointermove',
    { x: from.x + 6, y: from.y + 6 },
    init,
  );
  dispatchPointer(target, 'pointermove', to, init);
  dispatchPointer(target, 'pointerup', to, init);
}

describe('Canvas pointer drag in a real browser', () => {
  it('palette drag into an empty stack shows a box indicator and adds a child', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.PaletteItem type="cell">Cell</Canvas.PaletteItem>
        <Canvas.DropIndicator />
      </Canvas.Overlay>,
      stackOptions(emptyStackBlocks, emptyStackTree()),
    );
    const stack = host.querySelector('[data-editor-block="stack1"]');
    expect(stack).not.toBeNull();
    await waitForLayout(stack!);
    const stackRect = rectOf(stack!);
    const palette = host.querySelector('[data-editor-palette-item]')!;
    const paletteRect = palette.getBoundingClientRect();
    const from = {
      x: paletteRect.x + paletteRect.width / 2,
      y: paletteRect.y + paletteRect.height / 2,
    };
    const to = {
      x: stackRect.x + stackRect.width / 2,
      y: stackRect.y + stackRect.height / 2,
    };
    dispatchPointer(palette, 'pointerdown', from);
    dispatchPointer(palette, 'pointermove', { x: from.x + 6, y: from.y });
    await waitForLayout(host);
    const indicator = host.querySelector('[data-editor-drop-indicator]');
    expect(indicator).not.toBeNull();
    expect(indicator?.getAttribute('data-kind')).toBe('new');
    expect(indicator?.getAttribute('data-variant')).toBe('box');
    dispatchPointer(palette, 'pointermove', to);
    dispatchPointer(palette, 'pointerup', to);
    expect(store.getState().nodes.stack1!.childIds.length).toBe(1);
  });

  it('drops a nested-only type onto a stack that is not selected', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.PaletteItem type="cell">Cell</Canvas.PaletteItem>
        <Canvas.DropIndicator />
      </Canvas.Overlay>,
      {
        schema: nestedOnlyStackSchema,
        tree: emptyStackTree(),
        components: emptyStackBlocks,
      },
    );
    const stack = host.querySelector('[data-editor-block="stack1"]');
    expect(stack).not.toBeNull();
    await waitForLayout(stack!);
    const palette = host.querySelector(
      '[data-editor-palette-item]',
    ) as HTMLButtonElement;
    expect(palette.disabled).toBe(false);
    const stackRect = rectOf(stack!);
    const paletteRect = palette.getBoundingClientRect();
    dragPastThreshold(
      palette,
      {
        x: paletteRect.x + paletteRect.width / 2,
        y: paletteRect.y + paletteRect.height / 2,
      },
      {
        x: stackRect.x + stackRect.width / 2,
        y: stackRect.y + stackRect.height / 2,
      },
    );
    palette.click();
    expect(store.getState().nodes.stack1!.childIds.length).toBe(1);
  });

  it('moves a column sibling below the last sibling with same-parent correction', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DropIndicator />
        <Canvas.BlockToolbar side="top">
          <Canvas.DragHandle blockId="c1" data-testid="drag-c1" />
        </Canvas.BlockToolbar>
      </Canvas.Overlay>,
      stackOptions(columnStackBlocks, columnStackTree()),
    );
    const c3 = host.querySelector('[data-editor-block="c3"]');
    expect(c3).not.toBeNull();
    await waitForLayout(c3!);
    store.select('c1');
    await waitForLayout(host);
    const handle = host.querySelector('[data-editor-drag-handle]')!;
    const handleRect = handle.getBoundingClientRect();
    const c3Rect = rectOf(c3!);
    const from = {
      x: handleRect.x + handleRect.width / 2,
      y: handleRect.y + handleRect.height / 2,
    };
    const to = {
      x: c3Rect.x + c3Rect.width / 2,
      y: c3Rect.y + c3Rect.height - 2,
    };
    dragPastThreshold(handle, from, to);
    const ids = store.getState().nodes.stack1!.childIds;
    expect(ids.indexOf('c3')).toBeLessThan(ids.indexOf('c1'));
  });

  it('moves a row sibling to the right with a vertical drop indicator', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DropIndicator />
        <Canvas.BlockToolbar side="top">
          <Canvas.DragHandle blockId="c1" />
        </Canvas.BlockToolbar>
      </Canvas.Overlay>,
      stackOptions(rowStackBlocks, rowStackTree()),
    );
    const c3 = host.querySelector('[data-editor-block="c3"]');
    expect(c3).not.toBeNull();
    await waitForLayout(c3!);
    store.select('c1');
    await waitForLayout(host);
    const handle = host.querySelector('[data-editor-drag-handle]')!;
    const handleRect = handle.getBoundingClientRect();
    const c3Rect = rectOf(c3!);
    const from = {
      x: handleRect.x + handleRect.width / 2,
      y: handleRect.y + handleRect.height / 2,
    };
    const mid = {
      x: c3Rect.x + c3Rect.width - 2,
      y: c3Rect.y + c3Rect.height / 2,
    };
    dispatchPointer(handle, 'pointerdown', from);
    dispatchPointer(handle, 'pointermove', { x: from.x + 6, y: from.y });
    dispatchPointer(handle, 'pointermove', mid);
    await waitForLayout(host);
    const indicator = host.querySelector('[data-editor-drop-indicator]');
    expect(indicator?.getAttribute('data-orientation')).toBe('vertical');
    dispatchPointer(handle, 'pointerup', mid);
    const ids = store.getState().nodes.stack1!.childIds;
    expect(ids[ids.length - 1]).toBe('c1');
  });

  it('escape cancels an active move without mutating the tree', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DropIndicator />
        <Canvas.BlockToolbar side="top">
          <Canvas.DragHandle blockId="c1" />
        </Canvas.BlockToolbar>
      </Canvas.Overlay>,
      stackOptions(columnStackBlocks, columnStackTree()),
    );
    await waitForLayout(host);
    store.select('c1');
    await waitForLayout(host);
    const before = [...store.getState().nodes.stack1!.childIds];
    const handle = host.querySelector('[data-editor-drag-handle]')!;
    const handleRect = handle.getBoundingClientRect();
    const from = {
      x: handleRect.x + handleRect.width / 2,
      y: handleRect.y + handleRect.height / 2,
    };
    dispatchPointer(handle, 'pointerdown', from);
    dispatchPointer(handle, 'pointermove', { x: from.x + 8, y: from.y + 8 });
    await waitForLayout(host);
    expect(host.hasAttribute('data-dragging')).toBe(true);
    host.ownerDocument.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    await waitForLayout(host);
    expect(host.hasAttribute('data-dragging')).toBe(false);
    expect(host.querySelector('[data-editor-drop-indicator]')).toBeNull();
    expect(store.getState().nodes.stack1!.childIds).toEqual(before);
  });

  it('auto-scrolls the host near the bottom edge during a drag', async () => {
    const tallTree = columnStackTree();
    for (let i = 4; i <= 20; i++) {
      tallTree.children[0]!.children.push({
        blockId: `c${i}`,
        type: 'cell',
        properties: { text: String(i) },
        children: [],
      });
    }
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DropIndicator />
        <Canvas.BlockToolbar side="top">
          <Canvas.DragHandle blockId="c1" />
        </Canvas.BlockToolbar>
      </Canvas.Overlay>,
      {
        ...stackOptions(columnStackBlocks, tallTree),
        style: { height: 200 },
      },
    );
    await waitForLayout(host);
    store.select('c1');
    await waitForLayout(host);
    const handle = host.querySelector('[data-editor-drag-handle]')!;
    const handleRect = handle.getBoundingClientRect();
    const hostRect = rectOf(host);
    const from = {
      x: handleRect.x + handleRect.width / 2,
      y: handleRect.y + handleRect.height / 2,
    };
    const edge = {
      x: hostRect.x + hostRect.width / 2,
      y: hostRect.y + hostRect.height - 4,
    };
    dispatchPointer(handle, 'pointerdown', from);
    dispatchPointer(handle, 'pointermove', { x: from.x + 6, y: from.y });
    dispatchPointer(handle, 'pointermove', edge);
    const first = host.scrollTop;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
    const second = host.scrollTop;
    expect(second).toBeGreaterThan(first);
    dispatchPointer(handle, 'pointerup', edge);
  });

  it('accepts touch pointer input for column sibling moves', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DropIndicator />
        <Canvas.BlockToolbar side="top">
          <Canvas.DragHandle blockId="c1" />
        </Canvas.BlockToolbar>
      </Canvas.Overlay>,
      stackOptions(columnStackBlocks, columnStackTree()),
    );
    const c3 = host.querySelector('[data-editor-block="c3"]');
    await waitForLayout(c3!);
    store.select('c1');
    await waitForLayout(host);
    const handle = host.querySelector('[data-editor-drag-handle]')!;
    const handleRect = handle.getBoundingClientRect();
    const c3Rect = rectOf(c3!);
    const from = {
      x: handleRect.x + handleRect.width / 2,
      y: handleRect.y + handleRect.height / 2,
    };
    const to = {
      x: c3Rect.x + c3Rect.width / 2,
      y: c3Rect.y + c3Rect.height - 2,
    };
    dragPastThreshold(handle, from, to, {
      pointerType: 'touch',
      pointerId: 7,
    });
    const ids = store.getState().nodes.stack1!.childIds;
    expect(ids.indexOf('c3')).toBeLessThan(ids.indexOf('c1'));
  });

  it('shows no drop indicator when placement is forbidden', async () => {
    const closedRootSchema = {
      ...insertStackSchema,
      structure: {
        stack: { accepts: ['cell'] as const },
        root: { accepts: ['stack'] as const },
      },
    };
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.PaletteItem type="heading">Heading</Canvas.PaletteItem>
        <Canvas.DropIndicator />
      </Canvas.Overlay>,
      {
        schema: closedRootSchema,
        tree: columnStackTree(),
        components: columnStackBlocks,
      },
    );
    const stack = host.querySelector('[data-editor-block="stack1"]');
    await waitForLayout(stack!);
    const stackRect = rectOf(stack!);
    const palette = host.querySelector('[data-editor-palette-item]')!;
    const paletteRect = palette.getBoundingClientRect();
    const from = {
      x: paletteRect.x + paletteRect.width / 2,
      y: paletteRect.y + paletteRect.height / 2,
    };
    const to = {
      x: stackRect.x + stackRect.width / 2,
      y: stackRect.y + stackRect.height / 2,
    };
    const before = [...store.getState().nodes.stack1!.childIds];
    dispatchPointer(palette, 'pointerdown', from);
    dispatchPointer(palette, 'pointermove', { x: from.x + 6, y: from.y });
    dispatchPointer(palette, 'pointermove', to);
    await waitForLayout(host);
    expect(host.querySelector('[data-editor-drop-indicator]')).toBeNull();
    dispatchPointer(palette, 'pointerup', to);
    expect(store.getState().nodes.stack1!.childIds).toEqual(before);
  });

  it('selects the moved block and a newly dropped palette block', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DropIndicator />
        <Canvas.PaletteItem type="cell">Cell</Canvas.PaletteItem>
        <Canvas.BlockToolbar side="top">
          <Canvas.DragHandle blockId="c1" />
        </Canvas.BlockToolbar>
      </Canvas.Overlay>,
      stackOptions(columnStackBlocks, columnStackTree()),
    );
    const c3 = host.querySelector('[data-editor-block="c3"]');
    await waitForLayout(c3!);
    store.select('c1');
    await waitForLayout(host);
    const handle = host.querySelector('[data-editor-drag-handle]')!;
    const handleRect = handle.getBoundingClientRect();
    const c3Rect = rectOf(c3!);
    dragPastThreshold(
      handle,
      {
        x: handleRect.x + handleRect.width / 2,
        y: handleRect.y + handleRect.height / 2,
      },
      {
        x: c3Rect.x + c3Rect.width / 2,
        y: c3Rect.y + c3Rect.height - 2,
      },
    );
    expect(store.getState().selection.local?.selected).toBe('c1');

    const empty = host.querySelector('[data-editor-block="stack1"]');
    const emptyRect = rectOf(empty!);
    const palette = host.querySelector('[data-editor-palette-item]')!;
    const paletteRect = palette.getBoundingClientRect();
    dragPastThreshold(
      palette,
      {
        x: paletteRect.x + paletteRect.width / 2,
        y: paletteRect.y + paletteRect.height / 2,
      },
      {
        x: emptyRect.x + emptyRect.width / 2,
        y: emptyRect.y + 40,
      },
    );
    const newId = store
      .getState()
      .nodes.stack1!.childIds.find((id) => !['c1', 'c2', 'c3'].includes(id));
    expect(store.getState().selection.local?.selected).toBe(newId);
  });

  it('does not drag in select mode', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DropIndicator />
        <Canvas.BlockToolbar side="top">
          <Canvas.DragHandle blockId="c1" />
        </Canvas.BlockToolbar>
      </Canvas.Overlay>,
      {
        ...stackOptions(columnStackBlocks, columnStackTree()),
        interactive: 'select',
      },
    );
    await waitForLayout(host);
    store.select('c1');
    await waitForLayout(host);
    const before = [...store.getState().nodes.stack1!.childIds];
    const handle = host.querySelector('[data-editor-drag-handle]')!;
    const handleRect = handle.getBoundingClientRect();
    const from = {
      x: handleRect.x + handleRect.width / 2,
      y: handleRect.y + handleRect.height / 2,
    };
    dispatchPointer(handle, 'pointerdown', from);
    dispatchPointer(handle, 'pointermove', { x: from.x + 8, y: from.y + 8 });
    expect(host.hasAttribute('data-dragging')).toBe(false);
    expect(host.querySelector('[data-editor-drop-indicator]')).toBeNull();
    dispatchPointer(handle, 'pointerup', { x: from.x + 8, y: from.y + 8 });
    expect(store.getState().nodes.stack1!.childIds).toEqual(before);
  });
});

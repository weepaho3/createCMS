import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Canvas } from './index';
import {
  columnStackBlocks,
  columnStackTree,
  emptyStackBlocks,
  emptyStackTree,
  gridStackBlocks,
  gridStackTree,
  insertStackSchema,
  rowStackBlocks,
  rowStackTree,
} from './test/fixtures';
import {
  dispatchPointer,
  rectClose,
  rectOf,
  renderCanvas,
  waitForLayout,
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

describe('Canvas insert geometry in a real browser', () => {
  it('column stack inserts at the top gap with a horizontal line', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.InsertButton placement="between" type="cell">
          +
        </Canvas.InsertButton>
      </Canvas.Overlay>,
      stackOptions(columnStackBlocks, columnStackTree()),
    );
    const c1 = host.querySelector('[data-editor-block="c1"]');
    const c2 = host.querySelector('[data-editor-block="c2"]');
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    await waitForLayout(c1!);
    store.hover('c2');
    const top = rectOf(c1!);
    dispatchPointer(host, 'pointermove', {
      x: top.x + top.width / 2,
      y: top.y + 1,
    });
    await waitForLayout(host);
    const button = host.querySelector('[data-editor-insert-button]');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('data-orientation')).toBe('horizontal');
    const before = [...store.getState().nodes.stack1!.childIds];
    button!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    const after = store.getState().nodes.stack1!.childIds;
    expect(after.length).toBe(before.length + 1);
    expect(after[0]).not.toBe('c1');
    expect(after[1]).toBe('c1');
  });

  it('row stack inserts at the left gap with a vertical line', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.InsertButton placement="between" type="cell">
          +
        </Canvas.InsertButton>
      </Canvas.Overlay>,
      stackOptions(rowStackBlocks, rowStackTree()),
    );
    const c1 = host.querySelector('[data-editor-block="c1"]');
    expect(c1).not.toBeNull();
    await waitForLayout(c1!);
    store.hover('c1');
    const left = rectOf(c1!);
    dispatchPointer(host, 'pointermove', {
      x: left.x + 1,
      y: left.y + left.height / 2,
    });
    await waitForLayout(host);
    const button = host.querySelector('[data-editor-insert-button]');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('data-orientation')).toBe('vertical');
    const before = [...store.getState().nodes.stack1!.childIds];
    button!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    const after = store.getState().nodes.stack1!.childIds;
    expect(after.length).toBe(before.length + 1);
    expect(after[0]).not.toBe('c1');
  });

  it('grid stack inserts between the top row cells', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.InsertButton placement="between" type="cell">
          +
        </Canvas.InsertButton>
      </Canvas.Overlay>,
      stackOptions(gridStackBlocks, gridStackTree()),
    );
    const c1 = host.querySelector('[data-editor-block="c1"]');
    const c2 = host.querySelector('[data-editor-block="c2"]');
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    await waitForLayout(c1!);
    store.hover('c1');
    const a = rectOf(c1!);
    const b = rectOf(c2!);
    dispatchPointer(host, 'pointermove', {
      x: (a.x + a.width + b.x) / 2,
      y: a.y + a.height / 2,
    });
    await waitForLayout(host);
    const button = host.querySelector('[data-editor-insert-button]');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('data-orientation')).toBe('vertical');
    const before = [...store.getState().nodes.stack1!.childIds];
    button!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    const after = store.getState().nodes.stack1!.childIds;
    expect(after.length).toBe(before.length + 1);
    expect(after[1]).not.toBe('c2');
    expect(after[2]).toBe('c2');
  });

  it('empty stack shows a container insert box', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.InsertButton placement="container" type="cell">
          +
        </Canvas.InsertButton>
        <Canvas.InsertButton placement="between" type="cell">
          line
        </Canvas.InsertButton>
      </Canvas.Overlay>,
      stackOptions(emptyStackBlocks, emptyStackTree()),
    );
    const stack = host.querySelector('[data-editor-block="stack1"]');
    expect(stack).not.toBeNull();
    await waitForLayout(stack!);
    store.hover('stack1');
    const box = rectOf(stack!);
    dispatchPointer(host, 'pointermove', {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });
    await waitForLayout(host);
    const container = host.querySelector('[data-empty-container]');
    expect(container).not.toBeNull();
    expect(container?.getAttribute('data-orientation')).toBe('horizontal');
    expect(
      host.querySelector('[data-editor-insert-button][data-empty-container]'),
    ).not.toBeNull();
    const line = host.querySelector(
      '[data-editor-insert-button]:not([data-empty-container])',
    );
    expect(line).toBeNull();
    const before = [...store.getState().nodes.stack1!.childIds];
    container!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(store.getState().nodes.stack1!.childIds.length).toBe(
      before.length + 1,
    );
    expect(store.getState().nodes.stack1!.childIds[0]).not.toBeUndefined();
  });

  it('BlockToolbar follows selection with side bottom', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.BlockToolbar side="bottom" align="start" data-testid="tb" />
      </Canvas.Overlay>,
      stackOptions(rowStackBlocks, rowStackTree()),
    );
    const c1 = host.querySelector('[data-editor-block="c1"]');
    const c2 = host.querySelector('[data-editor-block="c2"]');
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    store.select('c1');
    await waitForLayout(c1!);
    const toolbar = host.querySelector('[data-editor-block-toolbar]');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.getAttribute('data-side')).toBe('bottom');
    expect(toolbar?.getAttribute('data-block-type')).toBe('cell');
    expect(
      rectClose(rectOf(toolbar!), {
        y: rectOf(c1!).y + rectOf(c1!).height,
      }),
    ).toBe(true);
    const left1 = rectOf(toolbar!).x;
    store.select('c2');
    await waitForLayout(c2!);
    const toolbar2 = host.querySelector('[data-editor-block-toolbar]');
    expect(toolbar2).not.toBeNull();
    expect(rectClose(rectOf(toolbar2!), { x: rectOf(c2!).x })).toBe(true);
    expect(rectOf(toolbar2!).x).not.toBe(left1);
  });

  it('BlockToolbar side top sits above the block', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.BlockToolbar side="top" align="start" />
      </Canvas.Overlay>,
      stackOptions(columnStackBlocks, columnStackTree()),
    );
    store.select('c2');
    const c2 = host.querySelector('[data-editor-block="c2"]');
    expect(c2).not.toBeNull();
    await waitForLayout(c2!);
    const toolbar = host.querySelector('[data-editor-block-toolbar]');
    expect(toolbar).not.toBeNull();
    const block = rectOf(c2!);
    const chrome = rectOf(toolbar!);
    expect(rectClose(chrome, { y: block.y - chrome.height })).toBe(true);
  });

  it('BlockToolbar side top stays hittable on the first block', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.BlockToolbar side="top" align="start">
          <span>grip</span>
        </Canvas.BlockToolbar>
      </Canvas.Overlay>,
      stackOptions(columnStackBlocks, columnStackTree()),
    );
    store.select('c1');
    const c1 = host.querySelector('[data-editor-block="c1"]');
    expect(c1).not.toBeNull();
    await waitForLayout(c1!);
    const overlay = host.querySelector('[data-editor-overlay]');
    const toolbar = host.querySelector('[data-editor-block-toolbar]');
    expect(overlay).not.toBeNull();
    expect(toolbar).not.toBeNull();
    const overlayBox = rectOf(overlay!);
    const toolbarBox = rectOf(toolbar!);
    expect(toolbarBox.y).toBeGreaterThanOrEqual(overlayBox.y - 1);
    const hit = host.ownerDocument.elementFromPoint(
      toolbarBox.x + Math.min(8, Math.max(1, toolbarBox.width / 2)),
      toolbarBox.y + Math.min(8, Math.max(1, toolbarBox.height / 2)),
    );
    expect(hit?.closest('[data-editor-block-toolbar]')).not.toBeNull();
  });

  it('InsertButton disables types the parent rejects', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.InsertButton placement="container" type="cell">
          cell
        </Canvas.InsertButton>
        <Canvas.InsertButton placement="container" type="heading">
          heading
        </Canvas.InsertButton>
      </Canvas.Overlay>,
      stackOptions(emptyStackBlocks, emptyStackTree()),
    );
    store.hover('stack1');
    const stack = host.querySelector('[data-editor-block="stack1"]');
    expect(stack).not.toBeNull();
    await waitForLayout(stack!);
    const box = rectOf(stack!);
    dispatchPointer(host, 'pointermove', {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    });
    await waitForLayout(host);
    const buttons = host.querySelectorAll('[data-editor-insert-button]');
    expect(buttons.length).toBe(2);
    const cellBtn = buttons[0] as HTMLButtonElement;
    const headingBtn = buttons[1] as HTMLButtonElement;
    expect(cellBtn.disabled).toBe(false);
    expect(headingBtn.disabled).toBe(true);
    const before = [...store.getState().nodes.stack1!.childIds];
    headingBtn.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
    expect(store.getState().nodes.stack1!.childIds).toEqual(before);
  });

  it('select mode hides InsertButton but keeps BlockToolbar', async () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.InsertButton placement="between" type="cell">
          +
        </Canvas.InsertButton>
        <Canvas.BlockToolbar />
      </Canvas.Overlay>,
      {
        ...stackOptions(columnStackBlocks, columnStackTree()),
        interactive: 'select',
      },
    );
    store.select('c1');
    store.hover('c1');
    const c1 = host.querySelector('[data-editor-block="c1"]');
    expect(c1).not.toBeNull();
    await waitForLayout(c1!);
    const top = rectOf(c1!);
    dispatchPointer(host, 'pointermove', {
      x: top.x + top.width / 2,
      y: top.y + top.height + 1,
    });
    await waitForLayout(host);
    expect(host.querySelector('[data-editor-insert-button]')).toBeNull();
    expect(host.querySelector('[data-editor-block-toolbar]')).not.toBeNull();
  });
});

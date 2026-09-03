import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorStore } from '../store';

import { Editor, useEditorContext } from '../index';
import { Canvas } from './index';
import {
  columnStackBlocks,
  columnStackTree,
  emptyStackBlocks,
  emptyStackTree,
  insertStackSchema,
} from './test/fixtures';
import {
  dispatchPointer,
  rectOf,
  waitForLayout,
  type Point,
} from './test/harness';

afterEach(cleanup);

type StoreProbeBag = { store: EditorStore | null };

function StoreProbe({ probe }: { probe: StoreProbeBag }) {
  probe.store = useEditorContext('StoreProbe').store;
  return null;
}

const hostStyle = {
  position: 'relative',
  boxSizing: 'border-box',
  width: 300,
  height: 300,
  overflow: 'auto',
} as const;

function centerOf(el: Element): Point {
  const rect = rectOf(el);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

describe('Canvas.Provider pointer drag in a real browser', () => {
  it('palette item outside the canvas drags into the canvas and adds a child', async () => {
    const probe: StoreProbeBag = { store: null };
    const utils = render(
      <Editor.Root schema={insertStackSchema} defaultValue={emptyStackTree()}>
        <StoreProbe probe={probe} />
        <Canvas.Provider>
          <aside>
            <Canvas.PaletteItem type="cell">Cell</Canvas.PaletteItem>
          </aside>
          <Canvas.Root
            data-testid="canvas"
            components={emptyStackBlocks}
            style={hostStyle}
          >
            <Canvas.Overlay>
              <Canvas.DropIndicator />
            </Canvas.Overlay>
          </Canvas.Root>
        </Canvas.Provider>
      </Editor.Root>,
    );
    const store = probe.store!;
    const host = utils.getByTestId('canvas');
    const stack = host.querySelector('[data-editor-block="stack1"]');
    expect(stack).not.toBeNull();
    await waitForLayout(stack!);
    const palette = utils.container.querySelector(
      'aside [data-editor-palette-item]',
    )!;
    expect(host.contains(palette)).toBe(false);
    const from = centerOf(palette);
    const to = centerOf(stack!);
    dispatchPointer(palette, 'pointerdown', from);
    dispatchPointer(palette, 'pointermove', { x: from.x + 6, y: from.y });
    dispatchPointer(palette, 'pointermove', to);
    await waitForLayout(host);
    const indicator = host.querySelector('[data-editor-drop-indicator]');
    expect(indicator).not.toBeNull();
    expect(indicator?.getAttribute('data-kind')).toBe('new');
    dispatchPointer(palette, 'pointerup', to);
    expect(store.getState().nodes.stack1!.childIds.length).toBe(1);
  });

  it('two canvases under one provider resolve drops on the hovered editable surface', async () => {
    const probe: StoreProbeBag = { store: null };
    const utils = render(
      <Editor.Root schema={insertStackSchema} defaultValue={emptyStackTree()}>
        <StoreProbe probe={probe} />
        <Canvas.Provider>
          <aside>
            <Canvas.PaletteItem type="cell">Cell</Canvas.PaletteItem>
          </aside>
          <div style={{ display: 'flex', gap: 16 }}>
            <Canvas.Root
              data-testid="canvas-a"
              components={emptyStackBlocks}
              interactive="select"
              style={hostStyle}
            />
            <Canvas.Root
              data-testid="canvas-b"
              components={emptyStackBlocks}
              style={hostStyle}
            >
              <Canvas.Overlay>
                <Canvas.DropIndicator />
              </Canvas.Overlay>
            </Canvas.Root>
          </div>
        </Canvas.Provider>
      </Editor.Root>,
    );
    const store = probe.store!;
    const hostA = utils.getByTestId('canvas-a');
    const hostB = utils.getByTestId('canvas-b');
    const stackA = hostA.querySelector('[data-editor-block="stack1"]');
    const stackB = hostB.querySelector('[data-editor-block="stack1"]');
    expect(stackA).not.toBeNull();
    expect(stackB).not.toBeNull();
    await waitForLayout(stackB!);
    const palette = utils.container.querySelector(
      'aside [data-editor-palette-item]',
    )!;
    const from = centerOf(palette);

    // Surface A is select-only: a drop over it resolves no target.
    const overA = centerOf(stackA!);
    dispatchPointer(palette, 'pointerdown', from);
    dispatchPointer(palette, 'pointermove', { x: from.x + 6, y: from.y });
    dispatchPointer(palette, 'pointermove', overA);
    await waitForLayout(hostA);
    expect(hostB.querySelector('[data-editor-drop-indicator]')).toBeNull();
    dispatchPointer(palette, 'pointerup', overA);
    expect(store.getState().nodes.stack1!.childIds.length).toBe(0);

    // Surface B is editable: the same drag over it commits the drop.
    const overB = centerOf(stackB!);
    dispatchPointer(palette, 'pointerdown', from);
    dispatchPointer(palette, 'pointermove', { x: from.x + 6, y: from.y });
    dispatchPointer(palette, 'pointermove', overB);
    await waitForLayout(hostB);
    expect(hostB.querySelector('[data-editor-drop-indicator]')).not.toBeNull();
    dispatchPointer(palette, 'pointerup', overB);
    expect(store.getState().nodes.stack1!.childIds.length).toBe(1);
  });

  it('DragHandle outside the canvas moves a sibling and does not add', async () => {
    const probe: StoreProbeBag = { store: null };
    const utils = render(
      <Editor.Root schema={insertStackSchema} defaultValue={columnStackTree()}>
        <StoreProbe probe={probe} />
        <Canvas.Provider>
          <aside>
            <Canvas.DragHandle blockId="c1">grip</Canvas.DragHandle>
          </aside>
          <Canvas.Root
            data-testid="canvas"
            components={columnStackBlocks}
            style={hostStyle}
          >
            <Canvas.Overlay>
              <Canvas.DropIndicator />
              <Canvas.DragPreview />
            </Canvas.Overlay>
          </Canvas.Root>
        </Canvas.Provider>
      </Editor.Root>,
    );
    const store = probe.store!;
    const host = utils.getByTestId('canvas');
    const c3 = host.querySelector('[data-editor-block="c3"]');
    expect(c3).not.toBeNull();
    await waitForLayout(c3!);
    const beforeIds = [...store.getState().nodes.stack1!.childIds];
    const beforeNodeCount = Object.keys(store.getState().nodes).length;
    const handle = utils.container.querySelector(
      'aside [data-editor-drag-handle]',
    )!;
    expect(host.contains(handle)).toBe(false);
    const from = centerOf(handle);
    const c3Rect = rectOf(c3!);
    const to = {
      x: c3Rect.x + c3Rect.width / 2,
      y: c3Rect.y + c3Rect.height - 2,
    };
    dispatchPointer(handle, 'pointerdown', from);
    dispatchPointer(handle, 'pointermove', { x: from.x + 6, y: from.y + 6 });
    dispatchPointer(handle, 'pointermove', to);
    dispatchPointer(handle, 'pointerup', to);
    const afterIds = store.getState().nodes.stack1!.childIds;
    expect(afterIds).toHaveLength(beforeIds.length);
    expect(afterIds.indexOf('c3')).toBeLessThan(afterIds.indexOf('c1'));
    expect(Object.keys(store.getState().nodes)).toHaveLength(beforeNodeCount);
  });
});

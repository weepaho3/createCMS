// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Editor } from '../index';
import { makeTree, storeSchema } from '../store/fixtures';
import { Canvas } from './index';
import { dispatchPointer, renderCanvas } from './test/harness';

afterEach(cleanup);

describe('Canvas.DragHandle', () => {
  it('throws outside Canvas.Root', () => {
    expect(() =>
      render(
        <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
          <Canvas.DragHandle blockId="h1" />
        </Editor.Root>,
      ),
    ).toThrow(
      'Canvas.DragHandle must be used within a Canvas.Provider or Canvas.Root component.',
    );
  });

  it('does not set host data-dragging before the threshold', () => {
    const { host } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DragHandle blockId="h1" data-testid="handle" />
      </Canvas.Overlay>,
    );
    const handle = host.querySelector('[data-editor-drag-handle]')!;
    const rect = handle.getBoundingClientRect();
    const from = { x: rect.x + 4, y: rect.y + 4 };
    dispatchPointer(handle, 'pointerdown', from);
    dispatchPointer(handle, 'pointermove', { x: from.x + 2, y: from.y });
    expect(host.hasAttribute('data-dragging')).toBe(false);
  });

  it('sets host data-dragging after the threshold', () => {
    const { host } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DragHandle blockId="h1" />
      </Canvas.Overlay>,
    );
    const handle = host.querySelector('[data-editor-drag-handle]')!;
    const rect = handle.getBoundingClientRect();
    const from = { x: rect.x + 4, y: rect.y + 4 };
    act(() => {
      dispatchPointer(handle, 'pointerdown', from);
      dispatchPointer(handle, 'pointermove', { x: from.x + 5, y: from.y });
    });
    expect(host.hasAttribute('data-dragging')).toBe(true);
  });

  it('starts a move while inline editing is active', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DragHandle blockId="h1" />
      </Canvas.Overlay>,
    );
    act(() => {
      store.setEditing({ blockId: 'h1', key: 'text' });
    });
    const handle = host.querySelector('[data-editor-drag-handle]')!;
    const rect = handle.getBoundingClientRect();
    const from = { x: rect.x + 4, y: rect.y + 4 };
    act(() => {
      dispatchPointer(handle, 'pointerdown', from);
      dispatchPointer(handle, 'pointermove', { x: from.x + 5, y: from.y });
    });
    expect(host.hasAttribute('data-dragging')).toBe(true);
    expect(store.getState().selection.local?.editing).toBeNull();
  });
});

describe('Canvas.PaletteItem', () => {
  it('throws outside Canvas.Root', () => {
    expect(() =>
      render(
        <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
          <Canvas.PaletteItem type="paragraph" />
        </Editor.Root>,
      ),
    ).toThrow(
      'Canvas.PaletteItem must be used within a Canvas.Provider or Canvas.Root component.',
    );
  });

  it('click inserts a paragraph after the selected block', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.PaletteItem type="paragraph">Add</Canvas.PaletteItem>
      </Canvas.Overlay>,
    );
    act(() => {
      store.select('h1');
    });
    const before = store.getState().nodes.root_1!.childIds.length;
    const button = host.querySelector('[data-editor-palette-item]')!;
    fireEvent.click(button);
    const after = store.getState().nodes.root_1!.childIds;
    expect(after.length).toBe(before + 1);
    expect(after.indexOf('h1')).toBe(0);
    expect(after[1]).not.toBe('h1');
    expect(after[1]).not.toBe('sec1');
  });

  it('stays enabled when click-insert cannot place the type', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.PaletteItem type="image">Image</Canvas.PaletteItem>
      </Canvas.Overlay>,
    );
    act(() => {
      store.select('p1');
    });
    const button = host.querySelector(
      '[data-editor-palette-item]',
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    const before = store.getState().nodes.root_1!.childIds.length;
    fireEvent.click(button);
    expect(store.getState().nodes.root_1!.childIds.length).toBe(before);
  });

  it('does not insert a second block when click follows a palette drag', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.PaletteItem type="paragraph">Add</Canvas.PaletteItem>
      </Canvas.Overlay>,
    );
    const before = store.getState().nodes.root_1!.childIds.length;
    const button = host.querySelector('[data-editor-palette-item]')!;
    const rect = button.getBoundingClientRect();
    const from = { x: rect.x + 4, y: rect.y + 4 };
    act(() => {
      dispatchPointer(button, 'pointerdown', from);
      dispatchPointer(button, 'pointermove', { x: from.x + 8, y: from.y });
      dispatchPointer(button, 'pointerup', { x: from.x + 8, y: from.y });
      fireEvent.click(button);
    });
    expect(
      store.getState().nodes.root_1!.childIds.length - before,
    ).toBeLessThanOrEqual(1);
  });
});

describe('Canvas.DropIndicator', () => {
  it('throws outside Canvas.Root', () => {
    expect(() =>
      render(
        <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
          <Canvas.DropIndicator />
        </Editor.Root>,
      ),
    ).toThrow(
      'Canvas.DropIndicator must be used within a Canvas.Root component.',
    );
  });

  it('is absent without a session', () => {
    const { host } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DropIndicator />
      </Canvas.Overlay>,
    );
    expect(host.querySelector('[data-editor-drop-indicator]')).toBeNull();
  });
});

describe('Canvas.DragPreview', () => {
  it('throws outside Canvas.Root', () => {
    expect(() =>
      render(
        <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
          <Canvas.DragPreview />
        </Editor.Root>,
      ),
    ).toThrow(
      'Canvas.DragPreview must be used within a Canvas.Provider or Canvas.Root component.',
    );
  });

  it('is absent without a session and follows the pointer with translate3d', () => {
    const { host } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DragHandle blockId="h1" />
        <Canvas.DragPreview />
      </Canvas.Overlay>,
    );
    expect(host.querySelector('[data-editor-drag-preview]')).toBeNull();
    const handle = host.querySelector('[data-editor-drag-handle]')!;
    const rect = handle.getBoundingClientRect();
    const from = { x: rect.x + 4, y: rect.y + 4 };
    act(() => {
      dispatchPointer(handle, 'pointerdown', from);
      dispatchPointer(handle, 'pointermove', { x: from.x + 8, y: from.y });
    });
    const preview = host.querySelector(
      '[data-editor-drag-preview]',
    ) as HTMLElement | null;
    expect(preview).not.toBeNull();
    expect(preview!.style.left).toBe('0px');
    expect(preview!.style.top).toBe('0px');
    expect(preview!.style.transform).toMatch(/translate3d\(/);
  });
});

describe('canvas drag escape', () => {
  it('clears data-dragging and leaves the tree unchanged', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DragHandle blockId="h1" />
        <Canvas.DropIndicator />
      </Canvas.Overlay>,
    );
    const before = [...store.getState().nodes.root_1!.childIds];
    const handle = host.querySelector('[data-editor-drag-handle]')!;
    const rect = handle.getBoundingClientRect();
    const from = { x: rect.x + 4, y: rect.y + 4 };
    act(() => {
      dispatchPointer(handle, 'pointerdown', from);
      dispatchPointer(handle, 'pointermove', { x: from.x + 8, y: from.y + 8 });
    });
    expect(host.hasAttribute('data-dragging')).toBe(true);
    act(() => {
      host.ownerDocument.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(host.hasAttribute('data-dragging')).toBe(false);
    expect(host.querySelector('[data-editor-drop-indicator]')).toBeNull();
    expect(store.getState().nodes.root_1!.childIds).toEqual(before);
  });

  it('ends a drag when pointerup happens off the handle', () => {
    const { host } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DragHandle blockId="h1" />
        <Canvas.DropIndicator />
      </Canvas.Overlay>,
    );
    const handle = host.querySelector('[data-editor-drag-handle]')!;
    const rect = handle.getBoundingClientRect();
    const from = { x: rect.x + 4, y: rect.y + 4 };
    act(() => {
      dispatchPointer(handle, 'pointerdown', from);
      dispatchPointer(handle, 'pointermove', { x: from.x + 8, y: from.y });
    });
    expect(host.hasAttribute('data-dragging')).toBe(true);
    act(() => {
      dispatchPointer(host, 'pointerup', {
        x: from.x + 80,
        y: from.y + 80,
      });
    });
    expect(host.hasAttribute('data-dragging')).toBe(false);
    expect(host.querySelector('[data-editor-drop-indicator]')).toBeNull();
  });
});

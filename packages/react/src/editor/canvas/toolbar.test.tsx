// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Editor } from '../index';
import { makeTree, storeSchema } from '../store/fixtures';
import { Canvas } from './index';
import { dispatchPointer, renderCanvas } from './test/harness';
import { useInsertTarget } from './toolbar';

afterEach(cleanup);

function InsertProbe() {
  useInsertTarget();
  return null;
}

describe('Canvas.BlockToolbar', () => {
  it('throws outside Canvas.Root', () => {
    expect(() =>
      render(
        <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
          <Canvas.BlockToolbar />
        </Editor.Root>,
      ),
    ).toThrow(
      'Canvas.BlockToolbar must be used within a Canvas.Root component.',
    );
  });

  it('mounts when a block is selected', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.BlockToolbar data-testid="toolbar" />
      </Canvas.Overlay>,
    );
    act(() => {
      store.select('h1');
    });
    const toolbar = host.ownerDocument.querySelector(
      '[data-editor-block-toolbar]',
    );
    expect(toolbar).not.toBeNull();
    expect(toolbar?.getAttribute('data-side')).toBe('top');
    expect(toolbar?.getAttribute('data-block-type')).toBe('heading');
  });

  it('is absent without selection', () => {
    const { host } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.BlockToolbar />
      </Canvas.Overlay>,
    );
    expect(
      host.ownerDocument.querySelector('[data-editor-block-toolbar]'),
    ).toBeNull();
  });

  it('is absent when interactive is none', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.BlockToolbar />
      </Canvas.Overlay>,
      { interactive: 'none' },
    );
    act(() => {
      store.select('h1');
    });
    expect(
      host.ownerDocument.querySelector('[data-editor-block-toolbar]'),
    ).toBeNull();
  });
});

describe('Canvas.InsertButton', () => {
  it('throws outside Canvas.Root', () => {
    expect(() =>
      render(
        <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
          <Canvas.InsertButton placement="between" />
        </Editor.Root>,
      ),
    ).toThrow(
      'Canvas.InsertButton must be used within a Canvas.Root component.',
    );
  });

  it('useInsertTarget throws outside Canvas.Root', () => {
    expect(() => render(<InsertProbe />)).toThrow(
      'useInsertTarget must be used within a Canvas.Root component.',
    );
  });

  it('between placement stays absent until pointer and hover exist', () => {
    const { host } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.InsertButton placement="between" type="paragraph" />
        <Canvas.InsertButton placement="container" type="paragraph" />
      </Canvas.Overlay>,
    );
    expect(
      host.ownerDocument.querySelector('[data-editor-insert-button]'),
    ).toBeNull();
  });

  it('does not crash after pointermove and hover', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.InsertButton placement="between" type="paragraph" />
        <Canvas.InsertButton placement="container" type="paragraph" />
      </Canvas.Overlay>,
    );
    act(() => {
      store.hover('h1');
    });
    const rect = host.getBoundingClientRect();
    dispatchPointer(host, 'pointermove', {
      x: rect.x + 50,
      y: rect.y + 20,
    });
    expect(host.querySelector('[data-editor-overlay]')).not.toBeNull();
  });
});

describe('overlay chrome hover guard', () => {
  it('keeps hover when pointer moves onto insert chrome', () => {
    const { host, store } = renderCanvas(
      <Canvas.Overlay>
        <button type="button" data-editor-insert-button>
          +
        </button>
      </Canvas.Overlay>,
    );
    act(() => {
      store.hover('h1');
    });
    const insert = host.querySelector('[data-editor-insert-button]');
    expect(insert).not.toBeNull();
    insert!.dispatchEvent(
      new Event('pointerover', { bubbles: true, cancelable: true }),
    );
    expect(store.getState().selection.local?.hovered).toBe('h1');
  });
});

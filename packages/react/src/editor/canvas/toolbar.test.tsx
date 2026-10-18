// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { makeDoc, storeSchema } from '../core/store/fixtures';
import { Editor } from '../index';
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
        <Editor.Root schema={storeSchema} defaultValue={makeDoc()}>
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

describe('Canvas.BlockToolbar keyboard', () => {
  function mountToolbar() {
    const utils = renderCanvas(
      <Canvas.Overlay>
        <Canvas.BlockToolbar>
          <button type="button">One</button>
          <button type="button" disabled>
            Off
          </button>
          <button type="button">Two</button>
          <button type="button">Three</button>
        </Canvas.BlockToolbar>
      </Canvas.Overlay>,
    );
    act(() => utils.store.select('h1'));
    const toolbar =
      utils.host.ownerDocument.querySelector<HTMLElement>('[role="toolbar"]')!;
    const buttons = [...toolbar.querySelectorAll('button')];
    return { ...utils, toolbar, buttons };
  }

  it('is named from the catalog and has one tab stop', () => {
    const { toolbar, buttons } = mountToolbar();
    expect(toolbar.getAttribute('aria-label')).toBe('Heading actions');
    const enabled = buttons.filter((b) => !b.disabled);
    expect(enabled.map((b) => b.tabIndex)).toEqual([0, -1, -1]);
  });

  it('arrows move with wrap and skip disabled items; Home and End jump', () => {
    const { buttons } = mountToolbar();
    const [one, , two, three] = buttons;
    one!.focus();
    fireEvent.keyDown(one!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(two);
    expect(two!.tabIndex).toBe(0);
    expect(one!.tabIndex).toBe(-1);
    fireEvent.keyDown(two!, { key: 'End' });
    expect(document.activeElement).toBe(three);
    fireEvent.keyDown(three!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(one);
    fireEvent.keyDown(one!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(three);
    fireEvent.keyDown(three!, { key: 'Home' });
    expect(document.activeElement).toBe(one);
  });

  it('Alt+F10 enters the toolbar without changing the selection; Escape returns', () => {
    const { buttons, store } = mountToolbar();
    const outside = document.createElement('input');
    document.body.append(outside);
    outside.focus();
    act(() => {
      store.commands.execute('ui.toolbar');
    });
    expect(document.activeElement).toBe(buttons[0]);
    expect(store.getSession().selection).toEqual(['h1']);
    fireEvent.keyDown(buttons[0]!, { key: 'Escape' });
    expect(document.activeElement).toBe(outside);
    expect(store.getSession().selection).toEqual(['h1']);
    outside.remove();
  });
});

describe('Canvas.InsertButton', () => {
  it('throws outside Canvas.Root', () => {
    expect(() =>
      render(
        <Editor.Root schema={storeSchema} defaultValue={makeDoc()}>
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
    expect(store.getEphemeral().hoverId).toBe('h1');
  });
});

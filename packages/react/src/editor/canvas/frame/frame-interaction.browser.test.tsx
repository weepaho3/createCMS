import { act, cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorDocument } from '../../core/document';
import type { AnyEditorSchema } from '../../core/schema';
import type { EditorStore } from '../../core/store';
import type { CanvasComponents } from '../map';

import { makeDoc, storeSchema } from '../../core/store/fixtures';
import { Editor, useEditorContext } from '../../index';
import { Canvas } from '../index';
import {
  canvasBlocks,
  columnStackBlocks,
  columnStackTree,
  emptyStackBlocks,
  emptyStackTree,
  insertStackSchema,
} from '../test/fixtures';
import { dispatchPointer, type Point } from '../test/harness';

afterEach(cleanup);

type Bag = { store: EditorStore | null };

function Probe({ bag }: { bag: Bag }) {
  bag.store = useEditorContext('Probe').store;
  return null;
}

function renderFrame(options: {
  schema?: AnyEditorSchema;
  tree?: EditorDocument;
  components?: CanvasComponents;
  overlay?: React.ReactNode;
  outside?: React.ReactNode;
  minHeight?: number;
  wrap?: (canvas: React.ReactNode) => React.ReactNode;
}) {
  const wrap = options.wrap ?? ((canvas: React.ReactNode) => canvas);
  const bag: Bag = { store: null };
  const utils = render(
    <Editor.Root
      schema={options.schema ?? storeSchema}
      defaultValue={options.tree ?? makeDoc()}
    >
      <Probe bag={bag} />
      <Canvas.Provider>
        {options.outside}
        {wrap(
          <Canvas.Root
            data-testid="outer"
            components={options.components ?? canvasBlocks}
            surface="frame"
            frame={{ styles: 'none', minHeight: options.minHeight }}
            style={{ width: 380 }}
          >
            {options.overlay}
          </Canvas.Root>,
        )}
      </Canvas.Provider>
    </Editor.Root>,
  );
  const frame = utils.getByTestId('outer').querySelector('iframe')!;
  return { ...utils, frame, store: () => bag.store! };
}

async function connected(frame: HTMLIFrameElement, block: string) {
  await waitFor(
    () => {
      const el = frame.contentDocument?.querySelector(
        `[data-editor-block="${block}"]`,
      );
      expect(el).not.toBeNull();
      expect(frame.getBoundingClientRect().height).toBeGreaterThan(20);
    },
    { timeout: 5000 },
  );
  return frame.contentDocument!;
}

/** The host-page client rect of an element inside the frame. */
function hostRect(frame: HTMLIFrameElement, el: Element): DOMRect {
  const f = frame.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return new DOMRect(f.left + r.left, f.top + r.top, r.width, r.height);
}

const center = (rect: DOMRect): Point => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

describe('overlay over a frame surface', () => {
  it('a surface ring in the frame matches the block rect within 1px', async () => {
    const { frame, store } = renderFrame({
      overlay: (
        <Canvas.Overlay>
          <Canvas.SelectionRing />
        </Canvas.Overlay>
      ),
    });
    const doc = await connected(frame, 'h1');
    act(() => store().select('h1'));
    await waitFor(() => {
      const ring = doc.querySelector('[data-editor-selection-ring]')!;
      const block = doc.querySelector('[data-editor-block="h1"]')!;
      const a = ring.getBoundingClientRect();
      const b = block.getBoundingClientRect();
      expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
    });
  });

  it('a host-layer toolbar of the first block leaves the frame and stays clickable', async () => {
    let clicked = false;
    const { frame, store, getByTestId } = renderFrame({
      overlay: (
        <Canvas.Overlay layer="host">
          <Canvas.BlockToolbar side="top" data-testid="toolbar">
            <button type="button" onClick={() => (clicked = true)}>
              Act
            </button>
          </Canvas.BlockToolbar>
        </Canvas.Overlay>
      ),
    });
    const doc = await connected(frame, 'h1');
    act(() => store().select('h1'));
    const toolbar = await waitFor(() => getByTestId('toolbar'));
    expect(toolbar.ownerDocument).toBe(document);
    const block = hostRect(
      frame,
      doc.querySelector('[data-editor-block="h1"]')!,
    );
    const box = toolbar.getBoundingClientRect();
    expect(box.bottom).toBeLessThanOrEqual(block.top + 1);
    expect(Math.abs(box.left - block.left)).toBeLessThanOrEqual(1);
    toolbar.querySelector('button')!.click();
    expect(clicked).toBe(true);
  });
});

describe('events in the frame document', () => {
  it('Mod+Z in the frame undoes', async () => {
    const { frame, store } = renderFrame({});
    const doc = await connected(frame, 'h1');
    act(() => {
      store().add('heading', { parent: { id: 'root_1' } });
    });
    const count = () => store().getDoc().nodes.root_1!.slots.children.length;
    expect(count()).toBe(3);
    act(() => {
      doc.body.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(count()).toBe(2);
  });

  it('a link click in the frame does not navigate', async () => {
    const { frame } = renderFrame({
      overlay: (
        <Canvas.Overlay>
          <a href="https://example.com" data-testid="link">
            Go
          </a>
        </Canvas.Overlay>
      ),
    });
    const doc = await connected(frame, 'h1');
    const link = doc.querySelector('[data-testid="link"]')!;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('a click on a block in the frame selects it', async () => {
    const { frame, store } = renderFrame({});
    const doc = await connected(frame, 'p1');
    (doc.querySelector('[data-editor-block="p1"]') as HTMLElement).click();
    expect(store().getSession().selection).toEqual(['p1']);
  });
});

describe('drag and drop across the frame boundary', () => {
  it('a palette drag from the host drops into the frame', async () => {
    const { frame, store } = renderFrame({
      schema: insertStackSchema,
      tree: emptyStackTree(),
      components: emptyStackBlocks,
      outside: (
        <Canvas.PaletteItem type="cell" data-testid="palette">
          Cell
        </Canvas.PaletteItem>
      ),
    });
    const doc = await connected(frame, 'stack1');
    const palette = document.querySelector('[data-editor-palette-item]')!;
    const from = center(palette.getBoundingClientRect());
    const to = center(
      hostRect(frame, doc.querySelector('[data-editor-block="stack1"]')!),
    );
    dispatchPointer(palette, 'pointerdown', from);
    dispatchPointer(document, 'pointermove', { x: from.x + 6, y: from.y });
    // The frame stops taking pointer events while a host drag runs.
    expect(frame.style.pointerEvents).toBe('none');
    dispatchPointer(document, 'pointermove', to);
    dispatchPointer(document, 'pointerup', to);
    expect(store().getDoc().nodes.stack1!.slots.children.length).toBe(1);
    expect(frame.style.pointerEvents).toBe('');
  });

  it('a block dragged in the frame past its edge and back drops correctly', async () => {
    const { frame, store } = renderFrame({
      schema: insertStackSchema,
      tree: columnStackTree(),
      components: columnStackBlocks,
      overlay: (
        <Canvas.Overlay>
          <Canvas.DragHandle blockId="c1">grip</Canvas.DragHandle>
        </Canvas.Overlay>
      ),
    });
    const doc = await connected(frame, 'c3');
    const handle = await waitFor(() => {
      const el = doc.querySelector('[data-editor-drag-handle]');
      expect(el).not.toBeNull();
      return el!;
    });
    const from = center(handle.getBoundingClientRect());
    const c3 = doc
      .querySelector('[data-editor-block="c3"]')!
      .getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    dispatchPointer(handle, 'pointerdown', from);
    dispatchPointer(doc, 'pointermove', { x: from.x + 6, y: from.y + 6 });
    // Outside the frame: the host page reports the pointer.
    dispatchPointer(document, 'pointermove', {
      x: frameRect.left + 10,
      y: frameRect.bottom + 30,
    });
    // Back inside, over the lower half of the last block.
    const to = { x: c3.x + c3.width / 2, y: c3.y + c3.height - 2 };
    dispatchPointer(doc, 'pointermove', to);
    dispatchPointer(doc, 'pointerup', to);
    const ids = store().getDoc().nodes.stack1!.slots.children;
    expect(ids.indexOf('c3')).toBeLessThan(ids.indexOf('c1'));
  });

  it('the page area below the content of a filled frame drops into the root', async () => {
    const { frame, store } = renderFrame({
      minHeight: 500,
      outside: (
        <Canvas.PaletteItem type="paragraph" data-testid="palette">
          Paragraph
        </Canvas.PaletteItem>
      ),
    });
    const doc = await connected(frame, 'p1');
    await waitFor(() =>
      expect(frame.getBoundingClientRect().height).toBeGreaterThanOrEqual(500),
    );
    const content = doc
      .querySelector('[data-editor-canvas]')!
      .getBoundingClientRect();
    expect(content.height).toBeLessThan(400);
    const palette = document.querySelector('[data-editor-palette-item]')!;
    const from = center(palette.getBoundingClientRect());
    const frameRect = frame.getBoundingClientRect();
    const below = { x: frameRect.left + 100, y: frameRect.top + 460 };
    dispatchPointer(palette, 'pointerdown', from);
    dispatchPointer(document, 'pointermove', { x: from.x + 6, y: from.y });
    dispatchPointer(document, 'pointermove', below);
    dispatchPointer(document, 'pointerup', below);
    const children = store().getDoc().nodes.root_1!.slots.children;
    expect(children).toHaveLength(3);
    expect(store().getDoc().nodes[children[2]!]!.type).toBe('paragraph');
  });

  it('a drag near the edge of the page around a growing frame scrolls the page', async () => {
    let scroller: HTMLDivElement | null = null;
    const { frame } = renderFrame({
      minHeight: 900,
      wrap: (canvas) => (
        <div
          ref={(el) => {
            scroller = el;
          }}
          style={{ height: 300, overflow: 'auto' }}
        >
          {canvas}
        </div>
      ),
      outside: (
        <Canvas.PaletteItem type="paragraph" data-testid="palette">
          Paragraph
        </Canvas.PaletteItem>
      ),
    });
    await connected(frame, 'p1');
    await waitFor(() =>
      expect(frame.getBoundingClientRect().height).toBeGreaterThanOrEqual(900),
    );
    const palette = document.querySelector('[data-editor-palette-item]')!;
    const from = center(palette.getBoundingClientRect());
    const box = scroller!.getBoundingClientRect();
    const edge = { x: box.left + 100, y: box.bottom - 5 };
    dispatchPointer(palette, 'pointerdown', from);
    dispatchPointer(document, 'pointermove', { x: from.x + 6, y: from.y });
    dispatchPointer(document, 'pointermove', edge);
    await waitFor(() => expect(scroller!.scrollTop).toBeGreaterThan(20), {
      timeout: 3000,
    });
    dispatchPointer(document, 'pointerup', edge);
  });
});

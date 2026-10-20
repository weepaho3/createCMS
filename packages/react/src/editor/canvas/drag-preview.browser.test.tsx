import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { defineEditorSchema } from '../core/schema';
import { makeDoc } from '../core/store/fixtures';
import { Editor } from '../index';
import { cloneBlockForPreview } from './drag-preview-clone';
import { Canvas } from './index';
import { canvasBlocks } from './test/fixtures';
import { dispatchPointer, renderCanvas } from './test/harness';

afterEach(() => {
  cleanup();
  document.head.querySelector('[data-test-style]')?.remove();
});

function block(html: string): HTMLElement {
  const style = document.createElement('style');
  style.setAttribute('data-test-style', '');
  style.textContent = '.title { color: rgb(255, 0, 0); font-size: 30px; }';
  document.head.append(style);
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host.firstElementChild as HTMLElement;
}

describe('cloneBlockForPreview', () => {
  it('keeps the resolved styles inline and drops what would run or take focus', () => {
    const el = block(`
      <section data-editor-block="b1" id="b1" style="width: 300px">
        <h2 class="title" data-editor-field="title" contenteditable="true">Title</h2>
        <input value="typed" />
        <iframe src="about:blank"></iframe>
        <video autoplay></video>
        <button onclick="alert(1)" tabindex="0">Go</button>
      </section>`);
    const clone = cloneBlockForPreview(el)!;
    expect(clone).not.toBeNull();
    expect(clone.width).toBe(300);
    const node = clone.node;
    expect(node.hasAttribute('inert')).toBe(true);
    expect(node.getAttribute('aria-hidden')).toBe('true');
    expect(
      node.querySelector('[data-editor-field], [data-editor-block]'),
    ).toBeNull();
    expect(node.hasAttribute('id')).toBe(false);
    const title = node.querySelector('h2')!;
    expect(title.hasAttribute('class')).toBe(false);
    expect(title.hasAttribute('contenteditable')).toBe(false);
    expect(title.style.color).toBe('rgb(255, 0, 0)');
    expect(title.style.fontSize).toBe('30px');
    expect(node.querySelector('iframe, video')).toBeNull();
    expect(node.querySelector('button')!.hasAttribute('onclick')).toBe(false);
    expect(node.querySelector('button')!.hasAttribute('tabindex')).toBe(false);
    expect(node.querySelector('input')!.getAttribute('value')).toBe('typed');
    el.parentElement!.remove();
  });

  it('gives up on a block with more elements than the cap, or without a box', () => {
    const el = block(
      `<div style="width: 100px">${'<span>x</span>'.repeat(20)}</div>`,
    );
    expect(cloneBlockForPreview(el, 10)).toBeNull();
    expect(cloneBlockForPreview(el, 50)).not.toBeNull();
    el.style.display = 'none';
    expect(cloneBlockForPreview(el)).toBeNull();
    el.parentElement!.remove();
  });
});

function dragHeading(host: HTMLElement) {
  const handle = host.querySelector<HTMLElement>('[data-editor-drag-handle]')!;
  const rect = handle.getBoundingClientRect();
  const from = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  dispatchPointer(handle, 'pointerdown', from);
  dispatchPointer(document, 'pointermove', { x: from.x + 20, y: from.y + 40 });
  dispatchPointer(document, 'pointermove', { x: from.x + 40, y: from.y + 80 });
  return () =>
    dispatchPointer(document, 'pointerup', { x: from.x + 40, y: from.y + 80 });
}

describe('Canvas.DragPreview', () => {
  it('shows a scaled copy of the dragged block', async () => {
    const { host } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DragHandle blockId="h1">grip</Canvas.DragHandle>
        <Canvas.DragPreview data-testid="preview" />
      </Canvas.Overlay>,
    );
    const drop = dragHeading(host);
    const preview = await waitFor(() => {
      const el = host.querySelector<HTMLElement>('[data-testid="preview"]');
      expect(el?.getAttribute('data-content')).toBe('block');
      return el!;
    });
    const box = preview.querySelector<HTMLElement>(
      '[data-editor-drag-preview-block]',
    )!;
    expect(box.textContent).toContain('Hello');
    expect(box.getBoundingClientRect().width).toBeLessThanOrEqual(280);
    expect(box.querySelector('[data-editor-block]')).toBeNull();
    drop();
  });

  it('preview="label" keeps the label chip', async () => {
    const { host } = renderCanvas(
      <Canvas.Overlay>
        <Canvas.DragHandle blockId="h1">grip</Canvas.DragHandle>
        <Canvas.DragPreview data-testid="preview" preview="label" />
      </Canvas.Overlay>,
    );
    const drop = dragHeading(host);
    await waitFor(() => {
      const el = host.querySelector('[data-testid="preview"]');
      expect(el?.getAttribute('data-content')).toBe('label');
      expect(
        el?.querySelector('[data-editor-drag-preview-label]'),
      ).not.toBeNull();
    });
    drop();
  });

  it('a new block from the palette shows its preview image', async () => {
    const schema = defineEditorSchema({
      root: { label: 'Page', fields: {}, slots: { children: {} } },
      components: {
        heading: {
          label: 'Heading',
          previewImageUrl: '/heading-preview.png',
          fields: { text: { type: 'text', label: 'Text' } },
        },
        paragraph: {
          label: 'Paragraph',
          fields: { text: { type: 'textarea', label: 'Body' } },
        },
        section: {
          label: 'Section',
          fields: { title: { type: 'text', label: 'Title' } },
          slots: { children: {} },
        },
      },
    });
    const utils = render(
      <Editor.Root schema={schema} defaultValue={makeDoc()}>
        <Canvas.Provider>
          <Canvas.PaletteItem type="heading">Heading</Canvas.PaletteItem>
          <Canvas.Root
            components={canvasBlocks}
            style={{ position: 'relative', width: 400, height: 300 }}
          >
            <Canvas.Overlay>
              <Canvas.DragPreview data-testid="preview" />
            </Canvas.Overlay>
          </Canvas.Root>
        </Canvas.Provider>
      </Editor.Root>,
    );
    const palette = utils.container.querySelector(
      '[data-editor-palette-item]',
    )!;
    const rect = palette.getBoundingClientRect();
    const from = { x: rect.x + 5, y: rect.y + 5 };
    const canvas = utils.container.querySelector('[data-editor-canvas]')!;
    const to = canvas.getBoundingClientRect();
    dispatchPointer(palette, 'pointerdown', from);
    dispatchPointer(document, 'pointermove', { x: from.x + 10, y: from.y });
    dispatchPointer(document, 'pointermove', { x: to.x + 50, y: to.y + 50 });
    await waitFor(() => {
      const el = utils.container.querySelector('[data-testid="preview"]');
      expect(el?.getAttribute('data-content')).toBe('image');
      expect(
        el
          ?.querySelector('[data-editor-drag-preview-image]')
          ?.getAttribute('src'),
      ).toBe('/heading-preview.png');
    });
    dispatchPointer(document, 'pointerup', { x: to.x + 50, y: to.y + 50 });
  });
});

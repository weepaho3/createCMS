import { act, cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { CanvasComponents } from '../canvas';
import type { EditorDocument } from '../core/document';
import type { RichTextDoc } from '../core/richtext/types';
import type { EditorStore } from '../core/store';

import { Canvas } from '../canvas';
import { useEditorContext } from '../context';
import { defineEditorSchema } from '../core/schema';
import { Editor, RichTextStatic } from '../index';
import { createTiptapAdapter } from './index';

afterEach(cleanup);

const schema = defineEditorSchema({
  root: { label: 'Pages', fields: {}, slots: { children: {} } },
  components: {
    note: {
      label: 'Note',
      fields: {
        body: { type: 'richText', label: 'Body', marks: ['bold', 'italic'] },
      },
    },
  },
});

const BODY: RichTextDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
      ],
    },
  ],
};

function tree(): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'root',
      type: 'root',
      props: {},
      slots: {
        children: [{ id: 'n1', type: 'note', props: { body: BODY } }],
      },
    },
  };
}

const components = {
  note: ({ edit, props }) => (
    <section {...edit.block} style={{ padding: 8 }}>
      <div {...edit.field.body} style={{ font: '16px/1.5 sans-serif' }}>
        <RichTextStatic value={props.body as RichTextDoc} />
      </div>
    </section>
  ),
} as CanvasComponents;

type Bag = { store: EditorStore | null };

function Probe({ bag }: { bag: Bag }) {
  bag.store = useEditorContext('Probe').store;
  return null;
}

function setup(surface: 'inline' | 'frame' = 'inline') {
  const bag: Bag = { store: null };
  const utils = render(
    <Editor.Root
      schema={schema}
      defaultValue={tree()}
      richText={createTiptapAdapter()}
    >
      <Probe bag={bag} />
      <Canvas.Root
        components={components}
        surface={surface}
        frame={{ styles: 'none', width: 600, scale: 1 }}
        style={{ position: 'relative', width: 600, height: 300 }}
      >
        <Canvas.Overlay>
          <Canvas.InlineText />
        </Canvas.Overlay>
        <Canvas.Overlay layer="host">
          <Canvas.BlockToolbar>
            <Canvas.InlineRichTextToolbar />
          </Canvas.BlockToolbar>
        </Canvas.Overlay>
      </Canvas.Root>
    </Editor.Root>,
  );
  const store = bag.store!;
  const body = () => store.getDoc().nodes.n1!.props.body as RichTextDoc;
  return { ...utils, store, body };
}

async function canvasDoc(container: HTMLElement): Promise<Document> {
  const frame = container.querySelector('iframe');
  if (!frame) return document;
  let doc: Document | null = null;
  await waitFor(() => {
    doc = frame.contentDocument;
    expect(doc?.querySelector('[data-editor-field="body"]')).not.toBeNull();
    // Auto height: the frame grows to its content after the first layout.
    expect(frame.getBoundingClientRect().height).toBeGreaterThan(40);
  });
  return doc!;
}

const field = (doc: Document) =>
  doc.querySelector<HTMLElement>('[data-editor-field="body"]')!;

/** Clicks at a client point of the canvas document (inline or framed). */
function clickAt(doc: Document, x: number, y: number) {
  const target = doc.elementFromPoint(x, y)!;
  const init = { bubbles: true, cancelable: true, clientX: x, clientY: y };
  act(() => {
    target.dispatchEvent(new PointerEvent('pointerdown', init));
    target.dispatchEvent(new MouseEvent('mousedown', init));
    target.dispatchEvent(new PointerEvent('pointerup', init));
    target.dispatchEvent(new MouseEvent('mouseup', init));
    target.dispatchEvent(new MouseEvent('click', init));
  });
}

const plain = (value: RichTextDoc) =>
  (value.content ?? [])
    .flatMap((p) => p.content ?? [])
    .map((n) => n.text ?? '')
    .join('');

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control';

describe.each(['inline', 'frame'] as const)(
  'inline rich text on the %s surface',
  (surface) => {
    it('a click mounts the editor in place with the caret at the click; Escape restores the rendered text', async () => {
      const { container, store, body } = setup(surface);
      const doc = await canvasDoc(container);
      const el = field(doc);
      expect(el.querySelector('strong')?.textContent).toBe('world');
      const box = el.querySelector('strong')!.getBoundingClientRect();
      // Right after "world": the end of the text.
      clickAt(doc, box.right - 1, box.top + box.height / 2);
      await waitFor(() =>
        expect(el.querySelector('[contenteditable="true"]')).not.toBeNull(),
      );
      const editable = el.querySelector<HTMLElement>(
        '[contenteditable="true"]',
      )!;
      expect(editable.querySelector('strong')?.textContent).toBe('world');
      expect(store.getSession().editing).toEqual({
        blockId: 'n1',
        key: 'body',
      });
      await waitFor(() => expect(doc.activeElement).toBe(editable));
      await userEvent.keyboard('!');
      await waitFor(() => expect(plain(body())).toBe('Hello world!'));
      await userEvent.keyboard('{Escape}');
      await waitFor(() =>
        expect(el.querySelector('[contenteditable]')).toBeNull(),
      );
      expect(store.getSession().editing).toBeNull();
      await waitFor(() => expect(el.textContent).toBe('Hello world!'));
      expect(el.querySelector('strong')?.textContent).toBe('world!');
    });

    it('undo after an inline edit restores the JSON exactly', async () => {
      const { container, store, body } = setup(surface);
      const doc = await canvasDoc(container);
      const el = field(doc);
      const box = el.querySelector('strong')!.getBoundingClientRect();
      clickAt(doc, box.right - 1, box.top + box.height / 2);
      await waitFor(() =>
        expect(doc.activeElement?.getAttribute('contenteditable')).toBe('true'),
      );
      await userEvent.keyboard('??');
      await waitFor(() => expect(plain(body())).toBe('Hello world??'));
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(store.getSession().editing).toBeNull());
      act(() => {
        void store.undo();
      });
      await waitFor(() => expect(body()).toEqual(BODY));
      await waitFor(() => expect(el.textContent).toBe('Hello world'));
    });

    it('the block toolbar formats the selection and the editor keeps its focus', async () => {
      const { container, body, findByRole } = setup(surface);
      const doc = await canvasDoc(container);
      const el = field(doc);
      const box = el.querySelector('strong')!.getBoundingClientRect();
      clickAt(doc, box.left - 20, box.top + box.height / 2);
      await waitFor(() =>
        expect(doc.activeElement?.getAttribute('contenteditable')).toBe('true'),
      );
      const editable = doc.activeElement as HTMLElement;
      await userEvent.keyboard(`{${mod}>}a{/${mod}}`);
      const italic = await findByRole('button', { name: 'Italic' });
      await userEvent.click(italic);
      await waitFor(() =>
        expect(
          body().content?.[0]?.content?.every((n) =>
            n.marks?.some((m) => m.type === 'italic'),
          ),
        ).toBe(true),
      );
      expect(doc.activeElement).toBe(editable);
      expect(italic.getAttribute('aria-pressed')).toBe('true');
    });
  },
);

describe('inline rich text without an editor', () => {
  it('a click selects the block and focuses the field, nothing mounts', () => {
    const bag: Bag = { store: null };
    const { container } = render(
      <Editor.Root schema={schema} defaultValue={tree()}>
        <Probe bag={bag} />
        <Canvas.Root components={components}>
          <Canvas.Overlay>
            <Canvas.InlineText />
          </Canvas.Overlay>
        </Canvas.Root>
      </Editor.Root>,
    );
    const el = field(document);
    const box = el.getBoundingClientRect();
    clickAt(document, box.left + 2, box.top + 2);
    expect(bag.store!.getSession().focusedField).toEqual({
      blockId: 'n1',
      key: 'body',
    });
    expect(bag.store!.getSession().editing).toBeNull();
    expect(container.querySelector('[contenteditable]')).toBeNull();
  });
});

void React;

import { cleanup, render, waitFor } from '@testing-library/react';
import { Collaboration } from '@tiptap/extension-collaboration';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import * as Y from 'yjs';

import type { EditorDocument } from '../core/document';
import type { RichTextDoc } from '../core/richtext/types';
import type { EditorStore } from '../core/store';

import { defineEditorSchema } from '../core/schema';
import { createEditorStore } from '../core/store';
import { Editor } from '../index';
import { createTiptapAdapter } from '../richtext/index';
import { createYjsDocStore } from './index';

afterEach(cleanup);

const schema = defineEditorSchema({
  root: { label: 'Pages', fields: {}, slots: { children: {} } },
  components: {
    note: {
      label: 'Note',
      fields: {
        body: { type: 'richText', label: 'Body', marks: ['bold'] },
      },
    },
  },
});

const doc = (text: string): RichTextDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const tree: EditorDocument = {
  schemaVersion: 1,
  root: {
    id: 'root',
    type: 'root',
    props: {},
    slots: {
      children: [{ id: 'n1', type: 'note', props: { body: doc('Hello') } }],
    },
  },
};

const richText = createTiptapAdapter({
  collaboration: { extension: Collaboration, syncOrigin: ySyncPluginKey },
});

/** Two editors on two Yjs documents connected like a live provider. */
function setup() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const seeded = createYjsDocStore({ ydoc: a, initialValue: tree });
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'network');
  const relay = (to: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (origin !== 'network') Y.applyUpdate(to, update, 'network');
  };
  a.on('update', relay(b));
  b.on('update', relay(a));
  const stores = [seeded, createYjsDocStore({ ydoc: b })].map((docStore) =>
    createEditorStore({ schema, docStore }),
  );
  const { container } = render(
    <>
      {stores.map((store, i) => (
        <section key={i} data-peer={i}>
          <Editor.Root store={store} richText={richText}>
            <Editor.Field blockId="n1" name="body">
              <Editor.FieldLabel />
              <Editor.FieldControl />
            </Editor.Field>
          </Editor.Root>
        </section>
      ))}
    </>,
  );
  const editable = async (peer: number) => {
    let found: HTMLElement | null = null;
    await waitFor(() => {
      found = container.querySelector<HTMLElement>(
        `[data-peer="${peer}"] [contenteditable="true"]`,
      );
      expect(found?.textContent).toBe('Hello');
    });
    return found!;
  };
  const body = (store: EditorStore) =>
    store.getDoc().nodes.n1!.props.body as RichTextDoc;
  return { stores, editable, body };
}

const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control';

describe('rich text bound to a Yjs store', () => {
  it('shows typing on the other peer and stores it as JSON on both', async () => {
    const { stores, editable, body } = setup();
    const left = await editable(0);
    const right = await editable(1);
    await userEvent.click(left);
    await userEvent.keyboard('{ArrowRight>10/}!!');
    await waitFor(() => expect(right.textContent).toBe('Hello!!'));
    for (const store of stores) {
      await waitFor(() => expect(body(store)).toEqual(doc('Hello!!')));
    }
  });

  it('merges typing of two people in the same paragraph', async () => {
    const { editable, body, stores } = setup();
    const left = await editable(0);
    const right = await editable(1);
    await userEvent.click(left);
    await userEvent.keyboard('{ArrowLeft>10/}A ');
    await userEvent.click(right);
    await userEvent.keyboard('{ArrowRight>10/} B');
    await waitFor(() => expect(left.textContent).toBe('A Hello B'));
    expect(right.textContent).toBe('A Hello B');
    expect(body(stores[1]!)).toEqual(doc('A Hello B'));
  });

  it('undo takes back only the own typing, as a local change', async () => {
    const { editable, stores } = setup();
    const left = await editable(0);
    const right = await editable(1);
    const origins: string[] = [];
    stores[0]!.on('change', (event) => origins.push(event.origin));
    await userEvent.click(left);
    await userEvent.keyboard('{ArrowRight>10/}!');
    await userEvent.click(right);
    await userEvent.keyboard('{ArrowLeft>10/}>');
    await waitFor(() => expect(left.textContent).toBe('>Hello!'));
    expect(origins).toContain('local');
    await userEvent.click(left);
    await userEvent.keyboard(`{${mod}>}z{/${mod}}`);
    await waitFor(() => expect(right.textContent).toBe('>Hello'));
    expect(left.textContent).toBe('>Hello');
  });
});

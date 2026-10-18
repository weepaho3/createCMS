import { getSchema } from '@tiptap/core';
import {
  prosemirrorJSONToYXmlFragment,
  yXmlFragmentToProsemirrorJSON,
} from '@tiptap/y-tiptap';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import type {
  EditorDocument,
  Origin,
  ProseMirrorJson,
  RichTextDoc,
} from '../core';

import {
  canonicalJson,
  createEditorStore,
  defineEditorSchema,
  normalizeRichTextJson,
  richTextSchemaOf,
} from '../core';
import { richTextExtensions } from '../richtext/extensions';
import {
  fragmentToRichText,
  sameRichText,
  writeRichText,
} from './rich-text-fragment';
import { createYjsDocStore } from './yjs-doc-store';

const body: RichTextDoc = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Title' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Plain, ' },
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' and ' },
        {
          type: 'text',
          text: 'a link',
          marks: [
            { type: 'italic' },
            {
              type: 'link',
              attrs: { link: { kind: 'external', url: 'https://a.test' } },
            },
          ],
        },
        { type: 'hardBreak' },
        { type: 'text', text: 'after the break' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
          ],
        },
      ],
    },
    { type: 'image', attrs: { assetId: 'asset-1', alt: 'A cat' } },
  ],
};

const key = (value: unknown) => canonicalJson(value as never);

const pmSchema = getSchema(richTextExtensions(richTextSchemaOf({})));

const page = (text: RichTextDoc | string): EditorDocument => ({
  schemaVersion: 1,
  root: {
    id: 'root',
    type: 'root',
    props: {},
    slots: {
      children: [{ id: 't', type: 'text', props: { body: text } }],
    },
  },
});

/** Two stores on two Yjs documents, synced on demand. */
function pair(initialValue: EditorDocument) {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const p = createYjsDocStore({ ydoc: a, initialValue });
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  const q = createYjsDocStore({ ydoc: b });
  const sync = () => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
  };
  return { p, q, a, b, sync };
}

/** The first text of the first paragraph-like element. */
function firstText(fragment: Y.XmlFragment): Y.XmlText {
  const find = (item: Y.XmlElement | Y.XmlFragment): Y.XmlText | null => {
    for (const child of item.toArray()) {
      if (child instanceof Y.XmlText) return child;
      if (child instanceof Y.XmlElement) {
        const found = find(child);
        if (found) return found;
      }
    }
    return null;
  };
  return find(fragment)!;
}

describe('rich text fragments', () => {
  it('round-trips a value through a fragment', () => {
    const fragment = new Y.Doc().getXmlFragment('body');
    writeRichText(fragment, body);
    expect(key(fragmentToRichText(fragment))).toBe(
      key(normalizeRichTextJson(body)),
    );
  });

  it('reads and writes the encoding of the Tiptap binding', () => {
    const ours = new Y.Doc().getXmlFragment('body');
    writeRichText(ours, body);
    expect(
      sameRichText(
        normalizeRichTextJson(
          yXmlFragmentToProsemirrorJSON(ours) as ProseMirrorJson,
        ),
        normalizeRichTextJson(body),
      ),
    ).toBe(true);
    const theirs = new Y.Doc().getXmlFragment('body');
    prosemirrorJSONToYXmlFragment(pmSchema, body, theirs);
    expect(
      sameRichText(fragmentToRichText(theirs), normalizeRichTextJson(body)),
    ).toBe(true);
  });
});

describe('rich text in the Yjs store', () => {
  it('keeps rich text props in fragments and hands them out as bindings', () => {
    const { p } = pair(page(body));
    const binding = p.getText?.('t', 'body');
    expect(binding?.fragment).toBeInstanceOf(Y.XmlFragment);
    expect(key(p.getSnapshot().nodes.t?.props.body)).toBe(
      key(normalizeRichTextJson(body)),
    );
    expect(p.getText?.('t', 'missing')).toBeNull();
  });

  it('merges concurrent typing in one paragraph instead of keeping one side', () => {
    const { p, q, sync } = pair(page(body));
    const left = p.getText?.('t', 'body')?.fragment as Y.XmlFragment;
    const right = q.getText?.('t', 'body')?.fragment as Y.XmlFragment;
    firstText(left).insert(0, 'Left ');
    firstText(right).insert(5, ' right');
    sync();
    const value = p.getSnapshot().nodes.t?.props.body as RichTextDoc;
    const heading = value.content?.[0];
    expect(heading?.content?.[0]?.text).toBe('Left Title right');
    expect(key(p.getSnapshot().nodes.t?.props)).toBe(
      key(q.getSnapshot().nodes.t?.props),
    );
  });

  it('reports writes of a bound editor as local and undoes them', () => {
    const { p } = pair(page(body));
    const origin = { name: 'sync plugin' };
    const binding = p.getText?.('t', 'body');
    binding?.track?.(origin);
    const origins: Origin[] = [];
    p.subscribe((_changes, o) => origins.push(o));
    const fragment = binding?.fragment as Y.XmlFragment;
    fragment.doc!.transact(() => firstText(fragment).insert(0, 'New '), origin);
    expect(origins).toEqual(['local']);
    const title = () => {
      const value = p.getSnapshot().nodes.t?.props.body as RichTextDoc;
      return value.content?.[0]?.content?.[0]?.text;
    };
    expect(title()).toBe('New Title');
    expect(p.canUndo()).toBe(true);
    p.undo();
    expect(title()).toBe('Title');
  });

  it('leaves the fragment alone when a write carries the content it holds', () => {
    const { p, a } = pair(page(body));
    let updates = 0;
    a.on('update', () => (updates += 1));
    p.transact((tx) => tx.setProp('t', ['body'], body));
    expect(updates).toBe(0);
  });

  it('turns a prop into text and back', () => {
    const { p, q, sync } = pair(page('plain'));
    expect(p.getText?.('t', 'body')).toBeNull();
    p.transact((tx) => tx.setProp('t', ['body'], body));
    sync();
    expect(q.getText?.('t', 'body')).not.toBeNull();
    expect(key(q.getSnapshot().nodes.t?.props.body)).toBe(
      key(normalizeRichTextJson(body)),
    );
    q.transact((tx) => tx.setProp('t', ['body'], 'plain again'));
    sync();
    expect(p.getText?.('t', 'body')).toBeNull();
    expect(p.getSnapshot().nodes.t?.props.body).toBe('plain again');
  });

  it('routes the editor store to the binding', () => {
    const schema = defineEditorSchema({
      root: { label: 'Page', fields: {}, slots: { children: {} } },
      components: {
        text: {
          label: 'Text',
          fields: { body: { type: 'richText', label: 'Body' } },
        },
      },
    });
    const { p } = pair(page(body));
    const store = createEditorStore({ schema, docStore: p });
    expect(store.getTextBinding('t', 'body')?.fragment).toBe(
      p.getText?.('t', 'body')?.fragment,
    );
  });
});

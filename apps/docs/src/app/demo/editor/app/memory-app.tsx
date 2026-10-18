'use client';

import type { CanvasComponents } from '@createcms/react/editor/canvas';
import type { EditorDocument } from '@createcms/react/editor/core';

import { RichTextStatic } from '@createcms/react/editor';
import {
  createMemoryAdapter,
  defineEditorSchema,
  isRichTextDoc,
} from '@createcms/react/editor/core';

import { EditorApp } from '@/components/editor-app';

const schema = defineEditorSchema({
  root: {
    label: 'Page',
    fields: { title: { type: 'text', label: 'Title', required: true } },
    slots: { children: {} },
  },
  components: {
    heading: {
      label: 'Heading',
      category: 'Content',
      fields: { text: { type: 'text', label: 'Text' } },
    },
    paragraph: {
      label: 'Paragraph',
      category: 'Content',
      fields: { body: { type: 'richText', label: 'Body' } },
    },
    section: {
      label: 'Section',
      category: 'Layout',
      fields: {
        tone: {
          type: 'select',
          label: 'Tone',
          options: [
            { label: 'Plain', value: 'plain' },
            { label: 'Muted', value: 'muted' },
          ],
        },
      },
      slots: { children: {} },
    },
  },
});

const components: CanvasComponents = {
  heading: ({ props, edit }) => (
    <h2 {...edit.block} className="px-6 py-3 text-2xl font-semibold">
      <span {...edit.field.text}>
        {typeof props.text === 'string' ? props.text : ''}
      </span>
    </h2>
  ),
  paragraph: ({ props, edit }) => (
    <div {...edit.block} className="px-6 py-2">
      <div {...edit.field.body} className="prose prose-sm max-w-none">
        <RichTextStatic value={isRichTextDoc(props.body) ? props.body : null} />
      </div>
    </div>
  ),
  section: ({ props, edit, children }) => (
    <section
      {...edit.block}
      className={
        props.tone === 'muted' ? 'bg-muted my-2 py-4' : 'my-2 border-y py-4'
      }
    >
      {children}
    </section>
  ),
};

const home: EditorDocument = {
  schemaVersion: 1,
  root: {
    id: 'root',
    type: 'root',
    props: { title: 'Home' },
    slots: {
      children: [
        { id: 'h1', type: 'heading', props: { text: 'Edited in memory' } },
        {
          id: 's1',
          type: 'section',
          props: { tone: 'muted' },
          slots: {
            children: [
              {
                id: 'p1',
                type: 'paragraph',
                props: {
                  body: {
                    type: 'doc',
                    content: [
                      {
                        type: 'paragraph',
                        content: [
                          {
                            type: 'text',
                            text: 'This page runs editor-app on createMemoryAdapter: no createCMS server, no database. Saves live until the page reloads.',
                          },
                        ],
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
      ],
    },
  },
};

// One adapter per page load; saves are kept until the page reloads.
const adapter = createMemoryAdapter({ home }, { latencyMs: 300 });

export function MemoryEditorApp() {
  return (
    <EditorApp
      adapter={adapter}
      documentId="home"
      baseVersion={adapter.version('home')}
      schema={schema}
      components={components}
    />
  );
}

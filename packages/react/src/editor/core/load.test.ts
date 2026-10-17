import { describe, expect, it } from 'vitest';

import type { EditorDocument } from './document';

import { DocumentLoadError, loadDocument } from './load';
import { defineEditorSchema } from './schema';
import { createEditorStore } from './store';

const schema = defineEditorSchema({
  root: { label: 'Root', fields: {}, slots: { children: {} } },
  aliases: { teaser: 'card' },
  components: {
    card: {
      label: 'Card',
      version: 3,
      fields: {
        title: { type: 'text' },
        level: { type: 'number', defaultValue: 2 },
      },
      migrations: [
        { to: 1, up: (props) => ({ ...props, title: props.headline ?? '' }) },
        {
          to: 2,
          up: (props) => {
            const { headline: _drop, ...rest } = props;
            return rest;
          },
        },
        { to: 3, up: (props) => ({ props: { ...props, migrated: true } }) },
      ],
    },
  },
});

let n = 0;
const genId = () => `fresh${++n}`;

function doc(children: unknown[]): unknown {
  return {
    schemaVersion: 1,
    root: { id: 'r', type: 'root', props: {}, slots: { children } },
  };
}

describe('loadDocument', () => {
  it('migrates a version 1 node through every step to version 3', () => {
    const { doc: out, diagnostics } = loadDocument(
      doc([{ id: 'c', type: 'card', v: 0, props: { headline: 'Hi' } }]),
      schema,
      { genId },
    );
    const card = out.root.slots?.children?.[0];
    expect(card).toMatchObject({
      v: 3,
      props: { title: 'Hi', migrated: true },
    });
    expect(card?.props).not.toHaveProperty('headline');
    expect(diagnostics.filter((d) => d.code === 'migrated')).toHaveLength(3);
  });

  it('is pure: the input is not changed, and a migrated document migrates no further', () => {
    const input = doc([{ id: 'c', type: 'card', props: { headline: 'Hi' } }]);
    const copy = structuredClone(input);
    const first = loadDocument(input, schema, { genId });
    expect(input).toEqual(copy);
    const second = loadDocument(first.doc, schema, { genId });
    expect(second.doc).toEqual(first.doc);
    expect(second.diagnostics).toEqual([]);
  });

  it('renames aliased types', () => {
    const { doc: out, diagnostics } = loadDocument(
      doc([{ id: 't', type: 'teaser', v: 3, props: {} }]),
      schema,
      { genId },
    );
    expect(out.root.slots?.children?.[0]?.type).toBe('card');
    expect(diagnostics[0]).toMatchObject({ code: 'alias', path: ['r', 't'] });
  });

  it('keeps unknown types as stored and reports them', () => {
    const widget = { id: 'w', type: 'widget', props: { a: 1 } };
    const { doc: out, diagnostics } = loadDocument(doc([widget]), schema, {
      genId,
    });
    expect(out.root.slots?.children?.[0]).toEqual(widget);
    expect(diagnostics).toEqual([
      expect.objectContaining({ code: 'unknown-type', path: ['r', 'w'] }),
    ]);
  });

  it('resets props of the wrong type and keeps the old value in the diagnostic', () => {
    const { doc: out, diagnostics } = loadDocument(
      doc([
        { id: 'c', type: 'card', v: 3, props: { level: 'high', title: 7 } },
      ]),
      schema,
      { genId },
    );
    expect(out.root.slots?.children?.[0]?.props).toEqual({ level: 2 });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'invalid-prop',
        path: ['r', 'c', 'title'],
        value: 7,
      }),
      expect.objectContaining({
        code: 'invalid-prop',
        path: ['r', 'c', 'level'],
        value: 'high',
      }),
    ]);
  });

  it('gives duplicate ids fresh ones', () => {
    const { doc: out, diagnostics } = loadDocument(
      doc([
        { id: 'c', type: 'card', v: 3, props: {} },
        { id: 'c', type: 'card', v: 3, props: {} },
      ]),
      schema,
      { genId: () => 'renamed' },
    );
    expect(out.root.slots?.children?.map((c) => c.id)).toEqual([
      'c',
      'renamed',
    ]);
    expect(diagnostics[0]).toMatchObject({ code: 'duplicate-id' });
  });

  it('reports a missing migration step and stops there', () => {
    const gappy = defineEditorSchema({
      root: { label: 'Root', fields: {}, slots: { children: {} } },
      components: {
        card: {
          label: 'Card',
          version: 2,
          fields: {},
          migrations: [{ to: 2, up: (p) => p }],
        },
      },
    });
    const { doc: out, diagnostics } = loadDocument(
      doc([{ id: 'c', type: 'card', props: {} }]),
      gappy,
      { genId },
    );
    expect(out.root.slots?.children?.[0]?.v).toBeUndefined();
    expect(diagnostics[0]).toMatchObject({
      code: 'migration-missing',
      severity: 'error',
    });
  });

  it('leaves out invalid nodes with a diagnostic and throws without a root', () => {
    const { doc: out, diagnostics } = loadDocument(
      doc([{ type: 'card' }]),
      schema,
      {
        genId,
      },
    );
    expect(out.root.slots?.children).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ code: 'invalid-node' });
    expect(() => loadDocument({}, schema, { genId })).toThrow(
      DocumentLoadError,
    );
  });

  it('the store runs the pipeline on initialValue and on load', () => {
    const seen: string[] = [];
    const store = createEditorStore({
      schema,
      initialValue: doc([
        { id: 'c', type: 'teaser', v: 3, props: {} },
      ]) as EditorDocument,
      onDiagnostics: (diagnostics) =>
        seen.push(...diagnostics.map((d) => d.code)),
    });
    expect(store.getDoc().nodes.c?.type).toBe('card');
    store.load(doc([{ id: 'x', type: 'card', props: {} }]) as EditorDocument);
    expect(store.getDoc().nodes.x?.v).toBe(3);
    expect(seen).toEqual(['alias', 'migrated', 'migrated', 'migrated']);
  });
});

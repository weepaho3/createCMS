import { describe, expect, it, vi } from 'vitest';

import type { EditorDocument, NodeData } from './document';

import { defineEditorSchema } from './schema';
import {
  applyOverrides,
  createSectionResolver,
  detachSection,
  REF_TYPE,
  sectionsPlugin,
} from './sections';
import { createEditorStore } from './store';
import { counterGenId } from './store/fixtures';

const schema = defineEditorSchema({
  root: { label: 'Page', fields: {}, slots: { children: {} } },
  components: {
    heading: {
      label: 'Heading',
      fields: {
        text: { type: 'text', label: 'Text' },
        level: { type: 'number', label: 'Level' },
      },
      exposedProps: ['text'],
    },
  },
});

const ref = (
  id: string,
  overrides?: Record<string, Record<string, string>>,
): NodeData => {
  const props: NodeData['props'] = { ref: { collection: 'sections', id } };
  if (overrides) props.overrides = overrides;
  return { id: `ref-${id}`, type: REF_TYPE, props };
};

const docOf = (children: NodeData[]): EditorDocument => ({
  schemaVersion: 1,
  root: { id: 'r', type: 'root', props: {}, slots: { children } },
});

const header = docOf([
  { id: 'hd', type: 'heading', props: { text: 'Welcome', level: 1 } },
]);

function resolverWith(docs: Record<string, EditorDocument>, maxDepth?: number) {
  const resolveReference = vi.fn(async ({ id }: { id: string }) => {
    const doc = docs[id];
    if (!doc) throw new Error('not found');
    return doc;
  });
  return {
    resolveReference,
    resolver: createSectionResolver({ resolveReference, schema, maxDepth }),
  };
}

describe('createSectionResolver', () => {
  it('resolves the root children once per reference and caches', async () => {
    const { resolver, resolveReference } = resolverWith({ header });
    const first = await resolver.resolve({
      collection: 'sections',
      id: 'header',
    });
    await resolver.resolve({ collection: 'sections', id: 'header' });
    expect(first.nodes.map((n) => n.id)).toEqual(['hd']);
    expect(first.diagnostics).toEqual([]);
    expect(resolveReference).toHaveBeenCalledTimes(1);
  });

  it('expands nested references and applies their overrides', async () => {
    const page = docOf([ref('header', { hd: { text: 'Hi' } })]);
    const { resolver } = resolverWith({ header, page });
    const { nodes } = await resolver.resolve({
      collection: 'sections',
      id: 'page',
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.props.text).toBe('Hi');
  });

  it('a cycle ends with a diagnostic instead of looping', async () => {
    const a = docOf([ref('b')]);
    const b = docOf([ref('a')]);
    const { resolver } = resolverWith({ a, b });
    const { nodes, diagnostics } = await resolver.resolve({
      collection: 'sections',
      id: 'a',
    });
    expect(nodes).toEqual([]);
    expect(diagnostics.map((d) => d.code)).toEqual(['reference-cycle']);
    expect(diagnostics[0]!.path).toEqual([
      'sections/a',
      'sections/b',
      'sections/a',
    ]);
  });

  it('stops at the depth limit and reports missing documents', async () => {
    const docs: Record<string, EditorDocument> = {
      l0: docOf([ref('l1')]),
      l1: docOf([ref('l2')]),
      l2: docOf([ref('missing')]),
    };
    const deep = resolverWith(docs, 2);
    const limited = await deep.resolver.resolve({
      collection: 'sections',
      id: 'l0',
    });
    expect(limited.diagnostics.map((d) => d.code)).toEqual(['reference-depth']);
    const full = resolverWith(docs, 5);
    const missing = await full.resolver.resolve({
      collection: 'sections',
      id: 'l0',
    });
    expect(missing.diagnostics.map((d) => d.code)).toEqual([
      'reference-missing',
    ]);
  });
});

describe('applyOverrides', () => {
  it('overrides only exposed props', () => {
    const [node] = applyOverrides(
      header.root.slots!.children!,
      { hd: { text: 'New', level: 3 } },
      schema,
    );
    expect(node!.props).toEqual({ text: 'New', level: 1 });
  });
});

describe('detachSection', () => {
  it('replaces the reference with an editable copy in one undo step', async () => {
    const { resolver } = resolverWith({ header });
    const store = createEditorStore({
      schema,
      initialValue: docOf([ref('header', { hd: { text: 'Hi' } })]),
      genId: counterGenId(),
      plugins: [sectionsPlugin({ resolver })],
    });
    expect(await detachSection(store, 'ref-header', resolver)).toBe(true);
    const children = store.getDoc().nodes.r!.slots.children!;
    expect(children).toHaveLength(1);
    const copy = store.getDoc().nodes[children[0]!]!;
    expect(copy.id).not.toBe('hd');
    expect(copy.type).toBe('heading');
    expect(copy.props.text).toBe('Hi');
    store.undo();
    expect(store.getDoc().nodes.r!.slots.children).toEqual(['ref-header']);
  });

  it('the plugin adds the $ref block and a block.detach command', async () => {
    const { resolver } = resolverWith({ header });
    const store = createEditorStore({
      schema,
      initialValue: docOf([ref('header')]),
      plugins: [sectionsPlugin({ resolver })],
    });
    expect(store.schema.components[REF_TYPE]?.label).toBe('Section');
    expect(store.commands.canExecute('block.detach')).toBe(false);
    store.select('ref-header');
    expect(store.commands.canExecute('block.detach')).toBe(true);
    await store.commands.execute('block.detach');
    expect(store.getDoc().nodes['ref-header']).toBeUndefined();
  });
});

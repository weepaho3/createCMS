// @vitest-environment happy-dom
import type { BlockTreeNode, CollectionDefinition } from '@createcms/schema';
import type * as React from 'react';

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EditorStore } from '../store';

import { useEditorContext } from '../context';
import { Editor, PREVIEW_DEBOUNCE_MS } from '../index';
import { makeTree, storeSchema } from '../store/fixtures';

afterEach(cleanup);

type Probe = { store: EditorStore | null };

function StoreProbe({ probe }: { probe: Probe }) {
  probe.store = useEditorContext('StoreProbe').store;
  return null;
}

function flushPreview(ms = PREVIEW_DEBOUNCE_MS) {
  act(() => {
    vi.advanceTimersByTime(ms);
    vi.advanceTimersByTime(16);
  });
}

function renderPreview(
  renderTree: (tree: BlockTreeNode) => React.ReactNode,
  options: { debounceMs?: number } = {},
) {
  const probe: Probe = { store: null };
  const utils = render(
    <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
      <StoreProbe probe={probe} />
      <Editor.Preview
        data-testid="preview"
        debounceMs={options.debounceMs}
        render={renderTree}
      />
    </Editor.Root>,
  );
  if (!probe.store) throw new Error('store probe did not mount');
  return { ...utils, store: probe.store };
}

describe('Editor.Preview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates after an op, debounced', () => {
    const { getByTestId, store } = renderPreview((tree) => (
      <span>{String(tree.properties.title)}</span>
    ));
    const preview = getByTestId('preview');
    expect(preview.textContent).toBe('Home');
    expect(preview.hasAttribute('data-stale')).toBe(false);
    act(() => {
      store.update('root_1', { title: 'Next' });
    });
    expect(preview.textContent).toBe('Home');
    expect(preview.getAttribute('data-stale')).toBe('');
    flushPreview();
    expect(getByTestId('preview').textContent).toBe('Next');
    expect(getByTestId('preview').hasAttribute('data-stale')).toBe(false);
  });

  it('two ops inside the window become one tree', () => {
    const titles: string[] = [];
    const { store } = renderPreview((tree) => {
      titles.push(String(tree.properties.title));
      return <span>{String(tree.properties.title)}</span>;
    });
    act(() => {
      store.update('root_1', { title: 'A' });
    });
    act(() => {
      store.update('root_1', { title: 'B' });
    });
    expect(titles.includes('A')).toBe(false);
    expect(titles[titles.length - 1]).toBe('Home');
    flushPreview();
    expect(titles.includes('A')).toBe(false);
    expect(titles[titles.length - 1]).toBe('B');
  });

  it('does not update without a tree change', () => {
    const trees: BlockTreeNode[] = [];
    const { getByTestId, store } = renderPreview((tree) => {
      trees.push(tree);
      return null;
    });
    const first = trees[0];
    expect(first).toBeDefined();
    act(() => {
      store.focus({ blockId: 'h1', key: 'text' });
    });
    expect(getByTestId('preview').hasAttribute('data-stale')).toBe(false);
    expect(trees[trees.length - 1]).toBe(first);
    expect(store.getTree()).toBe(first);
  });

  it('throws a precise error outside Editor.Root', () => {
    vi.useRealTimers();
    expect(() => render(<Editor.Preview render={() => null} />)).toThrow(
      'Editor.Preview must be used within an Editor.Root component.',
    );
  });
});

describe('focus roundtrip Field and store', () => {
  it('syncs Field focus into the store and store focus onto data-focused', () => {
    const probe: Probe = { store: null };
    const { getByTestId } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <StoreProbe probe={probe} />
        <Editor.Field blockId="h1" name="text" data-testid="text-field">
          <Editor.FieldControl />
        </Editor.Field>
        <Editor.Field blockId="h1" name="level" data-testid="level-field">
          <Editor.FieldControl />
        </Editor.Field>
      </Editor.Root>,
    );
    if (!probe.store) throw new Error('store probe did not mount');
    const textInput = getByTestId('text-field').querySelector(
      'input',
    ) as HTMLInputElement;
    fireEvent.focus(textInput);
    expect(probe.store.getState().selection.local?.focus).toEqual({
      blockId: 'h1',
      key: 'text',
    });
    expect(getByTestId('text-field').getAttribute('data-focused')).toBe('');
    act(() => {
      probe.store?.focus({ blockId: 'h1', key: 'level' });
    });
    expect(getByTestId('text-field').hasAttribute('data-focused')).toBe(false);
    expect(getByTestId('level-field').getAttribute('data-focused')).toBe('');
  });
});

const invoiceSchema = {
  label: 'Invoices',
  root: {
    properties: {
      number: { type: 'string', label: 'Number' },
      customer: { type: 'string', label: 'Customer' },
    },
  },
  blocks: {
    line: {
      label: 'Line',
      properties: {
        description: { type: 'string', label: 'Description' },
        amount: { type: 'number', label: 'Amount' },
      },
    },
  },
} satisfies CollectionDefinition;

function makeInvoice(): BlockTreeNode {
  return {
    blockId: 'root_1',
    type: 'root',
    properties: { number: 'INV-1', customer: 'Acme' },
    children: [
      {
        blockId: 'l1',
        type: 'line',
        properties: { description: 'Widget', amount: 10 },
        children: [],
      },
    ],
  };
}

function PDFViewer({ tree }: { tree: BlockTreeNode }) {
  const lines = (tree.children ?? [])
    .map(
      (child) =>
        `${String(child.properties.description)}:${String(child.properties.amount)}`,
    )
    .join(' ');
  return (
    <div data-testid="pdf">
      {String(tree.properties.number)} {String(tree.properties.customer)}{' '}
      {lines}
    </div>
  );
}

describe('form plus Preview with PDFViewer placeholder', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the invoice form and updates the preview after one rAF', () => {
    const probe: Probe = { store: null };
    const { getByTestId } = render(
      <Editor.Root schema={invoiceSchema} defaultValue={makeInvoice()}>
        <StoreProbe probe={probe} />
        <Editor.Form blockId="root_1" data-testid="form" />
        <Editor.Preview
          data-testid="preview"
          debounceMs={0}
          render={(tree) => <PDFViewer tree={tree} />}
        />
      </Editor.Root>,
    );
    if (!probe.store) throw new Error('store probe did not mount');
    expect(getByTestId('form').getAttribute('data-block-id')).toBe('root_1');
    expect(getByTestId('pdf').textContent).toContain('Acme');
    expect(getByTestId('pdf').textContent).toContain('Widget:10');
    act(() => {
      probe.store?.update('root_1', { customer: 'Beta' });
    });
    expect(getByTestId('pdf').textContent).toContain('Acme');
    flushPreview(0);
    expect(getByTestId('pdf').textContent).toContain('Beta');
    expect(getByTestId('pdf').textContent).not.toContain('Acme');
  });
});

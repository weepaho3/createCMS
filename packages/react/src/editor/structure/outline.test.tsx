// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorDocument } from '../core/document';
import type { EditorStore } from '../core/store';
import type { EditorOutlineProps } from './types';

import { useEditorContext } from '../context';
import { defineEditorSchema } from '../core/schema';
import { normalize } from '../core/store';
import { counterGenId, makeDoc, storeSchema } from '../core/store/fixtures';
import { Editor } from '../index';
import { outlineRows } from './outline-rows';

afterEach(cleanup);

type Probe = { store: EditorStore | null };

function StoreProbe({ probe }: { probe: Probe }) {
  probe.store = useEditorContext('StoreProbe').store;
  return null;
}

function mount(props: EditorOutlineProps = {}) {
  const probe: Probe = { store: null };
  const utils = render(
    <Editor.Root
      schema={storeSchema}
      defaultValue={makeDoc()}
      genId={counterGenId()}
    >
      <StoreProbe probe={probe} />
      <Editor.Outline {...props} />
    </Editor.Root>,
  );
  const store = () => probe.store!;
  const row = (id: string) =>
    utils.container.querySelector<HTMLElement>(`[data-tree-row-id="${id}"]`);
  const selected = () => store().getSession().selection[0] ?? null;
  return { ...utils, store, row, selected };
}

describe('Editor.Outline', () => {
  it('is a named, multiselectable tree of flat rows with levels and positions', () => {
    const { container, row } = mount();
    const tree = container.querySelector('[role="tree"]')!;
    expect(tree.getAttribute('aria-label')).toBe('Page structure');
    expect(tree.getAttribute('aria-multiselectable')).toBe('true');
    const items = tree.querySelectorAll('[role="treeitem"]');
    expect([...items].map((el) => el.getAttribute('data-tree-row-id'))).toEqual(
      ['h1', 'sec1', 'p1'],
    );
    // Rows are siblings, not nested.
    expect(row('p1')!.parentElement).toBe(tree);
    expect(row('p1')!.getAttribute('aria-level')).toBe('2');
    expect(row('sec1')!.getAttribute('aria-posinset')).toBe('2');
    expect(row('sec1')!.getAttribute('aria-setsize')).toBe('2');
    expect(row('sec1')!.getAttribute('aria-expanded')).toBe('true');
    expect(row('h1')!.hasAttribute('aria-expanded')).toBe(false);
    expect(row('h1')!.getAttribute('data-block-id')).toBe('h1');
    expect(row('h1')!.getAttribute('data-block-type')).toBe('heading');
    expect(row('p1')!.getAttribute('data-slot-name')).toBe('children');
    expect(row('h1')!.textContent).toBe('Heading');
  });

  it('click selects the row; aria-selected follows the selection', () => {
    const { row, selected } = mount();
    fireEvent.click(row('p1')!);
    expect(selected()).toBe('p1');
    expect(row('p1')!.getAttribute('aria-selected')).toBe('true');
    expect(row('p1')!.hasAttribute('data-selected')).toBe(true);
    expect(row('sec1')!.getAttribute('aria-selected')).toBe('false');
  });

  it('one tab stop: the first row, then the selected one', () => {
    const { row, store } = mount();
    expect(row('h1')!.tabIndex).toBe(0);
    expect(row('p1')!.tabIndex).toBe(-1);
    act(() => store().select('p1'));
    expect(row('h1')!.tabIndex).toBe(-1);
    expect(row('p1')!.tabIndex).toBe(0);
  });

  it('arrows select and focus the next row; Left and Right open, close and walk levels', () => {
    const { row, selected } = mount();
    row('h1')!.focus();
    fireEvent.keyDown(row('h1')!, { key: 'ArrowDown' });
    expect(selected()).toBe('sec1');
    expect(document.activeElement).toBe(row('sec1'));
    fireEvent.keyDown(row('sec1')!, { key: 'ArrowLeft' });
    expect(row('sec1')!.getAttribute('aria-expanded')).toBe('false');
    expect(row('p1')).toBeNull();
    fireEvent.keyDown(row('sec1')!, { key: 'ArrowRight' });
    fireEvent.keyDown(row('sec1')!, { key: 'ArrowRight' });
    expect(selected()).toBe('p1');
    fireEvent.keyDown(row('p1')!, { key: 'ArrowLeft' });
    expect(selected()).toBe('sec1');
    fireEvent.keyDown(row('sec1')!, { key: 'Home' });
    expect(selected()).toBe('h1');
  });

  it('Alt+Arrow moves the block among its siblings and keeps focus on it', () => {
    const { row, store } = mount();
    row('h1')!.focus();
    fireEvent.keyDown(row('h1')!, { key: 'ArrowUp', altKey: true });
    expect(store().getDoc().nodes.root_1!.slots.children).toEqual([
      'h1',
      'sec1',
    ]);
    fireEvent.keyDown(row('h1')!, { key: 'ArrowDown', altKey: true });
    expect(store().getDoc().nodes.root_1!.slots.children).toEqual([
      'sec1',
      'h1',
    ]);
    expect(document.activeElement).toBe(row('h1'));
  });

  it('Delete removes the block and lands on the next row outside it', () => {
    const { row, store, selected } = mount();
    row('sec1')!.focus();
    fireEvent.keyDown(row('sec1')!, { key: 'Delete' });
    expect(store().getDoc().nodes.p1).toBeUndefined();
    expect(selected()).toBe('h1');
    expect(document.activeElement).toBe(row('h1'));
    fireEvent.keyDown(row('h1')!, { key: 'Backspace' });
    expect(selected()).toBeNull();
  });

  it('onDelete returning false keeps the block', () => {
    const { row, store } = mount({ onDelete: () => false });
    fireEvent.keyDown(row('h1')!, { key: 'Delete' });
    expect(store().getDoc().nodes.h1).toBeDefined();
  });

  it('Escape clears the selection; a consumer preventDefault skips the keys', () => {
    const { row, store, selected } = mount();
    act(() => store().select('h1'));
    fireEvent.keyDown(row('h1')!, { key: 'Escape' });
    expect(selected()).toBeNull();
    cleanup();
    const second = mount({ onKeyDown: (event) => event.preventDefault() });
    second.row('h1')!.focus();
    fireEvent.keyDown(second.row('h1')!, { key: 'ArrowDown' });
    expect(second.selected()).toBeNull();
  });

  it('type-ahead jumps to the next row whose label starts with the letters', () => {
    const { row, selected } = mount();
    row('h1')!.focus();
    fireEvent.keyDown(row('h1')!, { key: 's' });
    expect(selected()).toBe('sec1');
  });

  it('pointer over a row hovers its block', () => {
    const { row, store } = mount();
    fireEvent.pointerEnter(row('h1')!);
    expect(store().getEphemeral().hoverId).toBe('h1');
    fireEvent.pointerLeave(row('h1')!);
    expect(store().getEphemeral().hoverId).toBeNull();
  });

  it('a selection made elsewhere expands its ancestors and moves the tab stop', () => {
    const { row, store } = mount();
    act(() => store().setCollapsed('sec1', true));
    expect(row('p1')).toBeNull();
    act(() => store().select('p1'));
    expect(row('p1')!.tabIndex).toBe(0);
  });

  it('children render custom rows; render replaces the element', () => {
    const { container } = mount({
      children: (row) => (
        <Editor.OutlineItem key={row.id} row={row} render={<li />}>
          <Editor.OutlineToggle>▸</Editor.OutlineToggle>
          {row.id}
        </Editor.OutlineItem>
      ),
    });
    const items = container.querySelectorAll('li[role="treeitem"]');
    expect(items).toHaveLength(3);
    expect(items[1]!.textContent).toBe('▸sec1');
    expect(items[0]!.textContent).toBe('h1');
  });
});

const slotSchema = defineEditorSchema({
  root: { label: 'Root', fields: {}, slots: { children: {} } },
  components: {
    columns: {
      label: 'Columns',
      fields: {},
      slots: {
        left: { label: 'Left column', allow: ['text'] },
        right: {},
      },
    },
    text: { label: 'Text', fields: {} },
  },
});

const slotDoc = (): EditorDocument => ({
  schemaVersion: 1,
  root: {
    id: 'r',
    type: 'root',
    props: {},
    slots: {
      children: [
        {
          id: 'cols',
          type: 'columns',
          props: {},
          slots: {
            left: [{ id: 't1', type: 'text', props: {} }],
            right: [],
          },
        },
      ],
    },
  },
});

describe('outline slot rows', () => {
  it('a block with named slots gets a row per slot, its blocks one level below', () => {
    const doc = slotDoc();
    const probe: Probe = { store: null };
    const { container } = render(
      <Editor.Root schema={slotSchema} defaultValue={doc}>
        <StoreProbe probe={probe} />
        <Editor.Outline />
      </Editor.Root>,
    );
    const items = [...container.querySelectorAll('[role="treeitem"]')];
    expect(
      items.map(
        (el) =>
          `${el.getAttribute('aria-level')}:${el.getAttribute('data-kind')}:${el.textContent}`,
      ),
    ).toEqual([
      '1:node:Columns',
      '2:slot:Left column',
      '3:node:Text',
      '2:slot:right',
    ]);
    // A slot row is never selected and never collapses.
    fireEvent.click(items[1]!);
    expect(probe.store!.getSession().selection).toEqual([]);
    (items[1] as HTMLElement).focus();
    fireEvent.keyDown(items[1]!, { key: 'ArrowLeft' });
    expect(probe.store!.getSession().selection).toEqual(['cols']);
  });

  it('outlineRows maps slot rows into the tree and leaves them out with slotRows none', () => {
    const { nodes, rootId } = normalize(slotDoc());
    const rows = outlineRows(slotSchema, nodes, rootId, []);
    expect(rows.map((r) => [r.id, r.parentId, r.level])).toEqual([
      ['cols', null, 1],
      ['cols:left', 'cols', 2],
      ['t1', 'cols:left', 3],
      ['cols:right', 'cols', 2],
    ]);
    const flat = outlineRows(slotSchema, nodes, rootId, [], {
      slotRows: 'none',
    });
    expect(flat.map((r) => [r.id, r.parentId, r.level])).toEqual([
      ['cols', null, 1],
      ['t1', 'cols', 2],
    ]);
  });
});

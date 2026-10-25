import { describe, expect, it } from 'vitest';

import type { EditorDocument } from '../core/document';

import { defineEditorSchema } from '../core/schema';
import { normalize } from '../core/store';
import { makeDoc, storeSchema } from '../core/store/fixtures';
import {
  outlineCanContain,
  outlineDropParent,
  outlineDropTarget,
} from './outline-drag';
import { outlineRows } from './outline-rows';

const page = normalize(makeDoc());
const pageRows = outlineRows(storeSchema, page.nodes, page.rootId, []);

describe('outline drops', () => {
  it('a block row stands for its only slot, null for the root', () => {
    expect(
      outlineDropParent(storeSchema, page.nodes, page.rootId, pageRows, 'sec1'),
    ).toEqual({ id: 'sec1', slot: 'children' });
    expect(
      outlineDropParent(storeSchema, page.nodes, page.rootId, pageRows, null),
    ).toEqual({ id: 'root_1', slot: 'children' });
  });

  it('blocks without slots take nothing into them', () => {
    const h1 = pageRows.find((row) => row.id === 'h1')!;
    const sec1 = pageRows.find((row) => row.id === 'sec1')!;
    expect(outlineCanContain(storeSchema, page.nodes, h1)).toBe(false);
    expect(outlineCanContain(storeSchema, page.nodes, sec1)).toBe(true);
  });

  it('placement rules refuse a target; an append lands at the end', () => {
    // A section takes only headings and paragraphs.
    expect(
      outlineDropTarget(
        storeSchema,
        page.nodes,
        page.rootId,
        pageRows,
        'sec1',
        { parentId: 'sec1', index: null },
      ),
    ).toBeNull();
    expect(
      outlineDropTarget(storeSchema, page.nodes, page.rootId, pageRows, 'h1', {
        parentId: 'sec1',
        index: null,
      }),
    ).toEqual({ parent: { id: 'sec1', slot: 'children' }, index: 1 });
    expect(
      outlineDropTarget(storeSchema, page.nodes, page.rootId, pageRows, 'p1', {
        parentId: null,
        index: 0,
      }),
    ).toEqual({ parent: { id: 'root_1', slot: 'children' }, index: 0 });
  });

  it('a block with slot rows takes drops only through them', () => {
    const schema = defineEditorSchema({
      root: { label: 'Root', fields: {}, slots: { children: {} } },
      components: {
        columns: {
          label: 'Columns',
          fields: {},
          slots: { left: {}, right: { allow: ['image'] } },
        },
        text: { label: 'Text', fields: {} },
        image: { label: 'Image', fields: {} },
      },
    });
    const doc: EditorDocument = {
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
              slots: { left: [], right: [] },
            },
            { id: 't1', type: 'text', props: {} },
          ],
        },
      },
    };
    const { nodes, rootId } = normalize(doc);
    const rows = outlineRows(schema, nodes, rootId, []);
    const cols = rows.find((row) => row.id === 'cols')!;
    expect(outlineCanContain(schema, nodes, cols)).toBe(false);
    expect(
      outlineDropTarget(schema, nodes, rootId, rows, 't1', {
        parentId: 'cols',
        index: null,
      }),
    ).toBeNull();
    expect(
      outlineDropTarget(schema, nodes, rootId, rows, 't1', {
        parentId: 'cols:left',
        index: 0,
      }),
    ).toEqual({ parent: { id: 'cols', slot: 'left' }, index: 0 });
    expect(
      outlineDropTarget(schema, nodes, rootId, rows, 't1', {
        parentId: 'cols:right',
        index: 0,
      }),
    ).toBeNull();
  });

  it('a block never drops into itself', () => {
    expect(
      outlineDropTarget(
        storeSchema,
        page.nodes,
        page.rootId,
        pageRows,
        'sec1',
        {
          parentId: 'sec1',
          index: 0,
        },
      ),
    ).toBeNull();
  });
});

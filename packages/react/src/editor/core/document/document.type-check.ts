/**
 * Compile-time guarantees for the document model. Ships nothing (no entry
 * imports it) but is covered by `tsc --noEmit`.
 */
import type { EditorDocument, FlatNode, NodeData, Op } from './types';

export const nested: EditorDocument = {
  schemaVersion: 1,
  root: {
    id: 'root',
    type: 'root',
    props: {},
    slots: {
      children: [
        {
          id: 'blk_1',
          type: 'columns',
          v: 2,
          props: { gap: { $r: { base: 8, md: 16 } } },
          slots: {
            left: [{ id: 'blk_2', type: 'text', props: { text: 'a' } }],
            right: [],
          },
          meta: { source: 'import' },
        },
      ],
    },
  },
};

export const withFunction: NodeData = {
  id: 'blk_3',
  type: 'text',
  // @ts-expect-error props hold JSON values only
  props: { onClick: () => undefined },
};

export const withUndefined: NodeData = {
  id: 'blk_4',
  type: 'text',
  // @ts-expect-error undefined is not a JSON value
  props: { text: undefined },
};

export const flat: FlatNode = {
  id: 'blk_1',
  type: 'columns',
  props: {},
  parent: { id: 'root', slot: 'children' },
  slots: { left: ['blk_2'], right: [] },
};

export const ops: Op[] = [
  {
    op: 'insert',
    parent: { id: 'root', slot: 'children' },
    index: 0,
    node: { id: 'blk_5', type: 'text', props: {} },
  },
  { op: 'update', id: 'blk_5', patch: { text: 'x', old: null } },
  { op: 'move', id: 'blk_5', parent: { id: 'blk_1', slot: 'left' }, index: 1 },
  { op: 'remove', id: 'blk_5' },
  { op: 'replace', doc: nested },
];

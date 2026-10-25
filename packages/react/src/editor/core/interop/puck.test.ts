import { describe, expect, it } from 'vitest';

import type { PuckData } from './puck';

import { defineEditorSchema } from '../schema/types';
import { validateDocument } from '../schema/validation';
import { fromPuckData, toPuckData } from './puck';

const schema = defineEditorSchema({
  root: {
    label: 'Page',
    fields: { title: { type: 'text', label: 'Title' } },
    slots: { children: {} },
  },
  components: {
    HeadingBlock: {
      label: 'Heading',
      fields: { title: { type: 'text', label: 'Title' } },
    },
    Columns: {
      label: 'Columns',
      fields: { gap: { type: 'number', label: 'Gap' } },
      slots: { left: {}, right: {} },
    },
  },
});

/** Shaped like the Puck 0.23 demo data: slots as props. */
const slotData: PuckData = {
  root: { props: { title: 'Home' } },
  content: [
    {
      type: 'HeadingBlock',
      props: { id: 'HeadingBlock-1f2e', title: 'Hello' },
      readOnly: { title: true },
    },
    {
      type: 'Columns',
      props: {
        id: 'Columns-9a8b',
        gap: 16,
        left: [
          {
            type: 'HeadingBlock',
            props: { id: 'HeadingBlock-77', title: 'Left' },
          },
        ],
        right: [],
      },
    },
  ],
};

/** The same page from releases before slots: `zones` keyed `id:zone`. */
const zoneData: PuckData = {
  root: { title: 'Home' },
  content: [
    {
      type: 'HeadingBlock',
      props: { id: 'HeadingBlock-1f2e', title: 'Hello' },
    },
    { type: 'Columns', props: { id: 'Columns-9a8b', gap: 16 } },
  ],
  zones: {
    'Columns-9a8b:left': [
      { type: 'HeadingBlock', props: { id: 'HeadingBlock-77', title: 'Left' } },
    ],
  },
};

let n = 0;
const genId = () => `blk_${(n += 1)}`;

describe('fromPuckData', () => {
  it('maps content, root props and slot props, drops readOnly, mints ids', async () => {
    n = 0;
    const doc = fromPuckData(slotData, { schema, genId });
    expect(doc).toEqual({
      schemaVersion: 1,
      root: {
        id: 'blk_1',
        type: 'root',
        props: { title: 'Home' },
        slots: {
          children: [
            { id: 'blk_2', type: 'HeadingBlock', props: { title: 'Hello' } },
            {
              id: 'blk_3',
              type: 'Columns',
              props: { gap: 16 },
              slots: {
                left: [
                  {
                    id: 'blk_4',
                    type: 'HeadingBlock',
                    props: { title: 'Left' },
                  },
                ],
                right: [],
              },
            },
          ],
        },
      },
    });
    const issues = await validateDocument(doc, schema);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('reads legacy zones and root fields outside props', () => {
    const doc = fromPuckData(zoneData, { schema, keepIds: true });
    expect(doc.root.props).toEqual({ title: 'Home' });
    const columns = doc.root.slots!.children![1]!;
    expect(columns.id).toBe('Columns-9a8b');
    expect(columns.slots?.left?.map((c) => c.props.title)).toEqual(['Left']);
  });
});

describe('toPuckData', () => {
  it('round-trips through the editor document', () => {
    const doc = fromPuckData(slotData, { schema, keepIds: true });
    const back = toPuckData(doc);
    expect(back).toEqual({
      root: { props: { title: 'Home' } },
      content: [
        {
          type: 'HeadingBlock',
          props: { id: 'HeadingBlock-1f2e', title: 'Hello' },
        },
        {
          type: 'Columns',
          props: {
            id: 'Columns-9a8b',
            gap: 16,
            left: [
              {
                type: 'HeadingBlock',
                props: { id: 'HeadingBlock-77', title: 'Left' },
              },
            ],
            right: [],
          },
        },
      ],
    });
    expect(fromPuckData(back, { schema, keepIds: true })).toEqual(doc);
  });
});

import { act, cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { EditorDocument } from '../core/document';
import type { EditorStore } from '../core/store';

import { useEditorContext } from '../context';
import { defineEditorSchema } from '../core/schema';
import { Editor } from '../index';
import { useOutlineRows } from './outline-rows';

afterEach(cleanup);

const schema = defineEditorSchema({
  root: { label: 'Page', fields: {}, slots: { children: {} } },
  components: {
    item: {
      label: 'Item',
      fields: { text: { type: 'text', label: 'Text' } },
      slots: { children: {} },
    },
  },
});

const COUNT = 1000;
const ROW = 24;
const WINDOW = 20;

function bigDoc(): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'root',
      type: 'root',
      props: {},
      slots: {
        children: Array.from({ length: COUNT }, (_, i) => ({
          id: `n${i}`,
          type: 'item',
          props: { text: `Row ${i}` },
          slots:
            i === 0
              ? {
                  children: [
                    { id: 'child', type: 'item', props: { text: 'Child' } },
                  ],
                }
              : undefined,
        })),
      },
    },
  };
}

/** A minimal windowed outline: only `WINDOW` rows are mounted. */
function WindowedOutline({ onStore }: { onStore: (s: EditorStore) => void }) {
  const { store } = useEditorContext('WindowedOutline');
  onStore(store);
  const rows = useOutlineRows();
  const [start, setStart] = React.useState(0);
  const reveal = React.useCallback(
    (id: string) => {
      const at = rows.findIndex((row) => row.id === id);
      setStart((current) =>
        at < current ? at : at >= current + WINDOW ? at - WINDOW + 1 : current,
      );
    },
    [rows],
  );
  return (
    <Editor.Outline
      rows={rows}
      range={{ start, end: start + WINDOW - 1 }}
      reveal={reveal}
      style={{ height: WINDOW * ROW }}
    >
      {(row) => (
        <Editor.OutlineItem
          key={row.id}
          row={row}
          style={{ height: ROW, paddingLeft: row.level * 12 }}
        >
          {row.id}
        </Editor.OutlineItem>
      )}
    </Editor.Outline>
  );
}

function setup() {
  let store: EditorStore | null = null;
  const utils = render(
    <Editor.Root schema={schema} defaultValue={bigDoc()}>
      <WindowedOutline onStore={(s) => (store = s)} />
    </Editor.Root>,
  );
  return { ...utils, store: () => store! };
}

const focusedId = () =>
  (document.activeElement as HTMLElement | null)?.dataset.blockId;

describe('windowed outline', () => {
  it('mounts only the visible rows and carries levels and positions', () => {
    const { container } = setup();
    const items = container.querySelectorAll('[role="treeitem"]');
    expect(items).toHaveLength(WINDOW);
    expect(items[0]!.getAttribute('aria-posinset')).toBe('1');
    expect(items[0]!.getAttribute('aria-setsize')).toBe(String(COUNT));
    expect(items[1]!.getAttribute('aria-level')).toBe('2');
  });

  it('arrows, End and Home reach rows that were not mounted', async () => {
    const { container, store } = setup();
    const first = container.querySelector<HTMLElement>('[data-block-id="n0"]')!;
    act(() => first.focus());
    for (let i = 0; i < WINDOW; i++) await userEvent.keyboard('{ArrowDown}');
    await waitFor(() => expect(focusedId()).toBe(`n${WINDOW - 1}`));
    expect(store().getSession().selection).toEqual([`n${WINDOW - 1}`]);
    await userEvent.keyboard('{End}');
    await waitFor(() => expect(focusedId()).toBe(`n${COUNT - 1}`));
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(
      WINDOW,
    );
    await userEvent.keyboard('{Home}');
    await waitFor(() => expect(focusedId()).toBe('n0'));
  });

  it('collapsing drops the children from the rows; Left goes to the parent', async () => {
    const { container, store } = setup();
    const child = container.querySelector<HTMLElement>(
      '[data-block-id="child"]',
    )!;
    act(() => child.focus());
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(focusedId()).toBe('n0'));
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(store().getSession().collapsed).toContain('n0'));
    expect(container.querySelector('[data-block-id="child"]')).toBeNull();
  });
});

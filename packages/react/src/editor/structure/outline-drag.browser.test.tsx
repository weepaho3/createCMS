import { cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorStore } from '../core/store';

import { useEditorContext } from '../context';
import { counterGenId, makeDoc, storeSchema } from '../core/store/fixtures';
import { Editor } from '../index';

afterEach(cleanup);

type Bag = { store: EditorStore | null };
function Probe({ bag }: { bag: Bag }) {
  bag.store = useEditorContext('Probe').store;
  return null;
}

function Tree() {
  return (
    <Editor.Outline
      data-testid="tree"
      indent={16}
      style={{ width: 300 }}
      indicator={<Editor.OutlineDropIndicator data-testid="line" />}
    >
      {(row) => (
        <Editor.OutlineItem
          key={row.id}
          row={row}
          style={{
            display: 'block',
            height: 24,
            paddingInlineStart: 'calc(var(--tree-indent) * var(--tree-level))',
          }}
        >
          {row.id}
        </Editor.OutlineItem>
      )}
    </Editor.Outline>
  );
}

function mount() {
  const bag: Bag = { store: null };
  const utils = render(
    <Editor.Root
      schema={storeSchema}
      defaultValue={makeDoc()}
      genId={counterGenId()}
    >
      <Probe bag={bag} />
      <Tree />
    </Editor.Root>,
  );
  return { ...utils, store: bag.store! };
}

const rowOf = (id: string) =>
  document.querySelector<HTMLElement>(`[data-tree-row-id="${id}"]`)!;
const label = (id: string) => rowOf(id).getBoundingClientRect();

function pointer(target: EventTarget, type: string, x: number, y: number) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
    }),
  );
}

function drag(fromId: string, to: { x: number; y: number }) {
  const from = label(fromId);
  const start = rowOf(fromId);
  pointer(start, 'pointerdown', from.x + 10, from.y + 12);
  pointer(document, 'pointermove', from.x + 10, from.y + 30);
  pointer(document, 'pointermove', to.x, to.y);
}

describe('outline drag', () => {
  it('dropping on the middle of a row nests the block in it', async () => {
    const { store } = mount();
    const sec = label('sec1');
    drag('h1', { x: sec.x + 40, y: sec.y + 12 });
    await waitFor(() => {
      expect(rowOf('sec1').hasAttribute('data-drop-target')).toBe(true);
    });
    expect(
      document.querySelector('[data-testid="line"]')!.hasAttribute('hidden'),
    ).toBe(true);
    pointer(document, 'pointerup', sec.x + 40, sec.y + 12);
    expect(store.getDoc().nodes.sec1!.slots.children).toEqual(['p1', 'h1']);
  });

  it('dragging left below the last row of a group moves the block out', async () => {
    const { store } = mount();
    const p1 = label('p1');
    const tree = document
      .querySelector('[data-testid="tree"]')!
      .getBoundingClientRect();
    drag('h1', { x: tree.x + 2, y: p1.y + p1.height - 2 });
    pointer(document, 'pointerup', tree.x + 2, p1.y + p1.height - 2);
    expect(store.getDoc().nodes.root_1!.slots.children).toEqual(['sec1', 'h1']);
    expect(store.getDoc().nodes.sec1!.slots.children).toEqual(['p1']);
  });

  it('a row drag selects no text and restores the page afterwards', async () => {
    mount();
    const tree = document.querySelector('[data-testid="tree"]')!;
    const root = document.documentElement;
    const range = document.createRange();
    range.selectNodeContents(tree);
    document.getSelection()!.addRange(range);
    const sec = label('sec1');
    drag('h1', { x: sec.x + 40, y: sec.y + 12 });
    expect(String(document.getSelection())).toBe('');
    expect(tree.hasAttribute('data-dragging')).toBe(true);
    // WebKit keeps only the prefixed property.
    const userSelect = () =>
      root.style.getPropertyValue('user-select') ||
      root.style.getPropertyValue('-webkit-user-select');
    expect(userSelect()).toBe('none');
    const select = new Event('selectstart', {
      bubbles: true,
      cancelable: true,
    });
    tree.dispatchEvent(select);
    expect(select.defaultPrevented).toBe(true);
    pointer(document, 'pointerup', sec.x + 40, sec.y + 12);
    expect(tree.hasAttribute('data-dragging')).toBe(false);
    expect(userSelect()).toBe('');
  });

  it('a target the placement rules refuse shows as blocked and drops nothing', async () => {
    const { store } = mount();
    const p1 = label('p1');
    // A section cannot go into a section.
    drag('sec1', { x: p1.x + 40, y: p1.y + p1.height - 2 });
    await waitFor(() =>
      expect(
        document
          .querySelector('[data-testid="line"]')!
          .hasAttribute('data-blocked'),
      ).toBe(true),
    );
    pointer(document, 'pointerup', p1.x + 40, p1.y + p1.height - 2);
    expect(store.getDoc().nodes.root_1!.slots.children).toEqual(['h1', 'sec1']);
  });

  it('between rows the line shows at the target level', async () => {
    const { store } = mount();
    const sec = label('sec1');
    drag('h1', { x: sec.x + 40, y: sec.y + sec.height - 2 });
    const line = document.querySelector<HTMLElement>('[data-testid="line"]')!;
    // The bottom edge of an expanded row drops in as its first child.
    await waitFor(() => expect(line.getAttribute('data-level')).toBe('2'));
    pointer(document, 'pointerup', sec.x + 40, sec.y + sec.height - 2);
    expect(store.getDoc().nodes.sec1!.slots.children).toEqual(['h1', 'p1']);
  });

  it('a collapsed row opens after resting on it', async () => {
    const { store } = mount();
    store.setCollapsed('sec1', true);
    await waitFor(() =>
      expect(document.querySelector('[data-tree-row-id="p1"]')).toBeNull(),
    );
    const sec = label('sec1');
    drag('h1', { x: sec.x + 40, y: sec.y + 12 });
    await waitFor(() => expect(store.getSession().collapsed).toEqual([]), {
      timeout: 2000,
    });
    pointer(document, 'pointerup', sec.x + 40, sec.y + 12);
  });
});

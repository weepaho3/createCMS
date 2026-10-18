import { cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorStore } from '../core/store';

import { useEditorContext } from '../context';
import { counterGenId, makeDoc, storeSchema } from '../core/store/fixtures';
import { useChildren } from '../hooks';
import { Editor } from '../index';

afterEach(cleanup);

type Bag = { store: EditorStore | null };
function Probe({ bag }: { bag: Bag }) {
  bag.store = useEditorContext('Probe').store;
  return null;
}

function Branch({ blockId }: { blockId: string }) {
  const nested = useChildren(blockId);
  return (
    <Editor.OutlineItem
      blockId={blockId}
      render={(props, state) => (
        <div {...props}>
          <span style={{ display: 'block', height: 24 }}>{blockId}</span>
          {state.expanded ? (
            <div style={{ paddingLeft: 16 }}>
              {nested.map((child) => (
                <Branch key={child.id} blockId={child.id} />
              ))}
            </div>
          ) : null}
        </div>
      )}
    />
  );
}

function Tree() {
  const nested = useChildren('root_1');
  return (
    <Editor.Outline data-testid="tree" style={{ width: 300 }}>
      {nested.map((child) => (
        <Branch key={child.id} blockId={child.id} />
      ))}
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

const label = (id: string) =>
  document
    .querySelector(`[data-block-id="${id}"] > span`)!
    .getBoundingClientRect();

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
  const start = document.querySelector(`[data-block-id="${fromId}"] > span`)!;
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
      expect(
        document
          .querySelector('[data-editor-outline-drop-indicator]')
          ?.getAttribute('data-variant'),
      ).toBe('box');
    });
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

  it('an invalid target shows no indicator and drops nothing', async () => {
    const { store } = mount();
    const p1 = label('p1');
    // A section cannot go into a section.
    drag('sec1', { x: p1.x + 40, y: p1.y + p1.height - 2 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      document.querySelector('[data-editor-outline-drop-indicator]'),
    ).toBeNull();
    pointer(document, 'pointerup', p1.x + 40, p1.y + p1.height - 2);
    expect(store.getDoc().nodes.root_1!.slots.children).toEqual(['h1', 'sec1']);
  });

  it('a collapsed row opens after resting on it', async () => {
    const { store } = mount();
    store.setCollapsed('sec1', true);
    await waitFor(() =>
      expect(document.querySelector('[data-block-id="p1"]')).toBeNull(),
    );
    const sec = label('sec1');
    drag('h1', { x: sec.x + 40, y: sec.y + 12 });
    await waitFor(() => expect(store.getSession().collapsed).toEqual([]), {
      timeout: 2000,
    });
    pointer(document, 'pointerup', sec.x + 40, sec.y + 12);
  });
});

// @vitest-environment happy-dom
import type * as React from 'react';

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { EditorStore } from '../store';

import { useEditorContext } from '../context';
import { useBlockActions, useChildren } from '../hooks';
import { Editor } from '../index';
import { counterGenId, makeTree, storeSchema } from '../store/fixtures';

afterEach(cleanup);

type Probe = { store: EditorStore | null };

function StoreProbe({ probe }: { probe: Probe }) {
  probe.store = useEditorContext('StoreProbe').store;
  return null;
}

function OutlineBranch({
  blockId,
  onDelete,
  onClick,
  onKeyDown,
  children,
}: {
  blockId: string;
  onDelete?: (id: string) => boolean | void;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  children?: React.ReactNode;
}) {
  const nested = useChildren(blockId);
  return (
    <Editor.OutlineItem
      blockId={blockId}
      onDelete={onDelete}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {children}
      {nested.map((child) => (
        <OutlineBranch
          key={child.id}
          blockId={child.id}
          onDelete={onDelete}
          onClick={onClick}
          onKeyDown={onKeyDown}
        />
      ))}
    </Editor.OutlineItem>
  );
}

function Outline(props: {
  onDelete?: (id: string) => boolean | void;
  onClick?: React.MouseEventHandler<HTMLDivElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
  children?: React.ReactNode;
}) {
  const nested = useChildren('root_1');
  return (
    <div role="tree">
      {nested.map((child) => (
        <OutlineBranch key={child.id} blockId={child.id} {...props} />
      ))}
    </div>
  );
}

function mount(ui?: React.ReactNode) {
  const probe: Probe = { store: null };
  const utils = render(
    <Editor.Root
      schema={storeSchema}
      defaultValue={makeTree()}
      genId={counterGenId()}
    >
      <StoreProbe probe={probe} />
      {ui ?? <Outline />}
    </Editor.Root>,
  );
  return { ...utils, probe };
}

function item(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector(`[data-block-id="${id}"]`);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`missing tree item ${id}`);
  }
  return el;
}

describe('Editor.OutlineItem', () => {
  it('sets role, aria and data attributes on every row', () => {
    const { container } = mount();
    const items = container.querySelectorAll('[role="treeitem"]');
    expect(items).toHaveLength(3);
    const h1 = item(container, 'h1');
    const sec1 = item(container, 'sec1');
    const p1 = item(container, 'p1');
    expect(h1.getAttribute('aria-level')).toBe('1');
    expect(sec1.getAttribute('aria-level')).toBe('1');
    expect(p1.getAttribute('aria-level')).toBe('2');
    expect(h1.getAttribute('aria-expanded')).toBeNull();
    expect(sec1.getAttribute('aria-expanded')).toBe('true');
    expect(p1.getAttribute('aria-expanded')).toBeNull();
    expect(h1.getAttribute('data-depth')).toBe('1');
    expect(sec1.getAttribute('data-depth')).toBe('1');
    expect(p1.getAttribute('data-depth')).toBe('2');
    expect(h1.hasAttribute('data-has-children')).toBe(false);
    expect(sec1.getAttribute('data-has-children')).toBe('');
    expect(p1.hasAttribute('data-has-children')).toBe(false);
    expect(h1.getAttribute('data-block-id')).toBe('h1');
    expect(h1.getAttribute('data-block-type')).toBe('heading');
    expect(sec1.getAttribute('data-block-type')).toBe('section');
    expect(p1.getAttribute('data-block-type')).toBe('paragraph');
  });

  it('click selects the row and sets aria-selected and data-selected', () => {
    const { container, probe } = mount();
    fireEvent.click(item(container, 'h1'));
    expect(probe.store?.getState().selection.local.selected).toBe('h1');
    const h1 = item(container, 'h1');
    const sec1 = item(container, 'sec1');
    expect(h1.getAttribute('aria-selected')).toBe('true');
    expect(h1.getAttribute('data-selected')).toBe('');
    expect(sec1.getAttribute('aria-selected')).toBe('false');
    expect(sec1.hasAttribute('data-selected')).toBe(false);
  });

  it('roving tabIndex: only h1 is 0 when nothing is selected; only p1 after select', () => {
    const { container, probe } = mount();
    expect(item(container, 'h1').tabIndex).toBe(0);
    expect(item(container, 'sec1').tabIndex).toBe(-1);
    expect(item(container, 'p1').tabIndex).toBe(-1);
    act(() => {
      probe.store?.select('p1');
    });
    expect(item(container, 'h1').tabIndex).toBe(-1);
    expect(item(container, 'sec1').tabIndex).toBe(-1);
    expect(item(container, 'p1').tabIndex).toBe(0);
  });

  it('ArrowDown from h1 selects and focuses sec1, then p1; ArrowUp returns; first item is a no-op', () => {
    const { container, probe } = mount();
    const h1 = item(container, 'h1');
    h1.focus();
    expect(document.activeElement).toBe(h1);
    fireEvent.keyDown(h1, { key: 'ArrowDown' });
    expect(probe.store?.getState().selection.local.selected).toBe('sec1');
    expect(document.activeElement).toBe(item(container, 'sec1'));
    fireEvent.keyDown(item(container, 'sec1'), { key: 'ArrowDown' });
    expect(probe.store?.getState().selection.local.selected).toBe('p1');
    expect(document.activeElement).toBe(item(container, 'p1'));
    fireEvent.keyDown(item(container, 'p1'), { key: 'ArrowUp' });
    expect(probe.store?.getState().selection.local.selected).toBe('sec1');
    act(() => {
      probe.store?.select('h1');
    });
    item(container, 'h1').focus();
    fireEvent.keyDown(item(container, 'h1'), { key: 'ArrowUp' });
    expect(probe.store?.getState().selection.local.selected).toBe('h1');
  });

  it('Alt+ArrowDown on h1 reorders and keeps focus; Alt+ArrowUp on the first item is a no-op', () => {
    const { container, probe } = mount();
    const h1 = item(container, 'h1');
    h1.focus();
    fireEvent.keyDown(h1, { key: 'ArrowUp', altKey: true });
    expect(probe.store?.getState().nodes.root_1?.childIds).toEqual([
      'h1',
      'sec1',
    ]);
    fireEvent.keyDown(h1, { key: 'ArrowDown', altKey: true });
    expect(probe.store?.getState().nodes.root_1?.childIds).toEqual([
      'sec1',
      'h1',
    ]);
    expect(document.activeElement).toBe(item(container, 'h1'));
  });

  it('Delete on h1 removes it and focuses sec1', () => {
    const { container, probe } = mount();
    const h1 = item(container, 'h1');
    h1.focus();
    fireEvent.keyDown(h1, { key: 'Delete' });
    expect(probe.store?.getState().nodes.h1).toBeUndefined();
    expect(probe.store?.getState().selection.local.selected).toBe('sec1');
    expect(document.activeElement).toBe(item(container, 'sec1'));
  });

  it('Delete on the last remaining item clears the selection', () => {
    const { container, probe } = mount();
    fireEvent.keyDown(item(container, 'h1'), { key: 'Delete' });
    fireEvent.keyDown(item(container, 'sec1'), { key: 'Delete' });
    expect(probe.store?.getState().nodes.sec1).toBeUndefined();
    expect(probe.store?.getState().selection.local.selected).toBeNull();
  });

  it('Backspace removes like Delete', () => {
    const { container, probe } = mount();
    fireEvent.keyDown(item(container, 'h1'), { key: 'Backspace' });
    expect(probe.store?.getState().nodes.h1).toBeUndefined();
  });

  it('onDelete returning false keeps the block and the selection', () => {
    const probe: Probe = { store: null };
    const { container } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <StoreProbe probe={probe} />
        <Outline onDelete={() => false} />
      </Editor.Root>,
    );
    act(() => {
      probe.store?.select('h1');
    });
    fireEvent.keyDown(item(container, 'h1'), { key: 'Delete' });
    expect(probe.store?.getState().nodes.h1).toBeDefined();
    expect(probe.store?.getState().selection.local.selected).toBe('h1');
  });

  it('onDelete returning undefined removes the block', () => {
    const probe: Probe = { store: null };
    const { container } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <StoreProbe probe={probe} />
        <Outline onDelete={() => undefined} />
      </Editor.Root>,
    );
    fireEvent.keyDown(item(container, 'h1'), { key: 'Delete' });
    expect(probe.store?.getState().nodes.h1).toBeUndefined();
  });

  it('Delete on sec1 lands on h1, not on its descendant p1', () => {
    const { container, probe } = mount();
    fireEvent.keyDown(item(container, 'sec1'), { key: 'Delete' });
    expect(probe.store?.getState().nodes.sec1).toBeUndefined();
    expect(probe.store?.getState().nodes.p1).toBeUndefined();
    expect(probe.store?.getState().selection.local.selected).toBe('h1');
    expect(document.activeElement).toBe(item(container, 'h1'));
  });

  it('Escape clears the selection', () => {
    const { container, probe } = mount();
    act(() => {
      probe.store?.select('h1');
    });
    fireEvent.keyDown(item(container, 'h1'), { key: 'Escape' });
    expect(probe.store?.getState().selection.local.selected).toBeNull();
  });

  it('consumer onKeyDown preventDefault disables the built-in key handling', () => {
    const probe: Probe = { store: null };
    const { container } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <StoreProbe probe={probe} />
        <Outline onKeyDown={(event) => event.preventDefault()} />
      </Editor.Root>,
    );
    fireEvent.keyDown(item(container, 'h1'), { key: 'ArrowDown' });
    expect(probe.store?.getState().selection.local.selected).toBeNull();
  });

  it('consumer onClick runs before selecting', () => {
    const probe: Probe = { store: null };
    let selectedDuringClick: string | null | undefined;
    const { container } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <StoreProbe probe={probe} />
        <Outline
          onClick={() => {
            selectedDuringClick =
              probe.store?.getState().selection.local.selected;
          }}
        />
      </Editor.Root>,
    );
    fireEvent.click(item(container, 'h1'));
    expect(selectedDuringClick).toBeNull();
    expect(probe.store?.getState().selection.local.selected).toBe('h1');
  });

  it('a click on the nested p1 row selects p1, not sec1', () => {
    const { container, probe } = mount();
    fireEvent.click(item(container, 'p1'));
    expect(probe.store?.getState().selection.local.selected).toBe('p1');
  });

  it('a keydown inside an input rendered within a row is ignored', () => {
    const probe: Probe = { store: null };
    const { container, getByTestId } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <StoreProbe probe={probe} />
        <div role="tree">
          <Editor.OutlineItem blockId="h1">
            <input data-testid="inner" />
          </Editor.OutlineItem>
        </div>
      </Editor.Root>,
    );
    const input = getByTestId('inner');
    input.focus();
    fireEvent.keyDown(input, { key: 'Delete' });
    expect(probe.store?.getState().nodes.h1).toBeDefined();
    expect(container.querySelector('[data-block-id="h1"]')).not.toBeNull();
  });

  it('render={<li />} yields an li with role and data attributes', () => {
    const { container } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <Editor.OutlineItem blockId="h1" render={<li />} />
      </Editor.Root>,
    );
    const el = container.querySelector('li');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('role')).toBe('treeitem');
    expect(el?.getAttribute('data-block-id')).toBe('h1');
    expect(el?.getAttribute('data-block-type')).toBe('heading');
  });

  it('unknown blockId renders nothing', () => {
    const { container } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <Editor.OutlineItem blockId="nope" />
      </Editor.Root>,
    );
    expect(container.querySelector('[role="treeitem"]')).toBeNull();
  });
});

describe('Editor.AddBlock', () => {
  it('with nothing selected inserts at the end of the root and selects it', () => {
    const { getByRole, probe } = mount(<Editor.AddBlock type="heading" />);
    fireEvent.click(getByRole('button', { name: 'Heading' }));
    expect(probe.store?.getState().nodes.root_1?.childIds).toEqual([
      'h1',
      'sec1',
      'n1',
    ]);
    expect(probe.store?.getState().selection.local.selected).toBe('n1');
  });

  it('with sec1 selected inserts inside sec1', () => {
    const { getByRole, probe } = mount(<Editor.AddBlock type="heading" />);
    act(() => {
      probe.store?.select('sec1');
    });
    fireEvent.click(getByRole('button', { name: 'Heading' }));
    expect(probe.store?.getState().nodes.sec1?.childIds).toEqual(['p1', 'n1']);
  });

  it('with h1 selected inserts after h1 in the root', () => {
    const { getByRole, probe } = mount(<Editor.AddBlock type="heading" />);
    act(() => {
      probe.store?.select('h1');
    });
    fireEvent.click(getByRole('button', { name: 'Heading' }));
    expect(probe.store?.getState().nodes.root_1?.childIds).toEqual([
      'h1',
      'n1',
      'sec1',
    ]);
  });

  it('explicit parentId and index insert first under sec1', () => {
    const { getByRole, probe } = mount(
      <Editor.AddBlock type="heading" parentId="sec1" index={0} />,
    );
    fireEvent.click(getByRole('button', { name: 'Heading' }));
    expect(probe.store?.getState().nodes.sec1?.childIds).toEqual(['n1', 'p1']);
  });

  it('type=image with sec1 selected inserts after sec1 in the root', () => {
    const { getByRole, probe } = mount(<Editor.AddBlock type="image" />);
    act(() => {
      probe.store?.select('sec1');
    });
    const button = getByRole('button', { name: 'Image' });
    expect(button).toHaveProperty('disabled', false);
    fireEvent.click(button);
    expect(probe.store?.getState().nodes.root_1?.childIds).toEqual([
      'h1',
      'sec1',
      'n1',
    ]);
  });

  it('type=image parentId=sec1 is disabled; with nothing selected it is enabled', () => {
    const disabled = mount(<Editor.AddBlock type="image" parentId="sec1" />);
    expect(disabled.getByRole('button', { name: 'Image' })).toHaveProperty(
      'disabled',
      true,
    );
    disabled.unmount();
    const open = mount(<Editor.AddBlock type="image" />);
    expect(open.getByRole('button', { name: 'Image' })).toHaveProperty(
      'disabled',
      false,
    );
  });

  it('label defaults to the palette label and children override', () => {
    const def = mount(<Editor.AddBlock type="heading" />);
    expect(def.getByRole('button').textContent).toBe('Heading');
    def.unmount();
    const custom = mount(
      <Editor.AddBlock type="heading">Insert heading</Editor.AddBlock>,
    );
    expect(custom.getByRole('button').textContent).toBe('Insert heading');
  });

  it('sets data-block-type', () => {
    const { getByRole } = mount(<Editor.AddBlock type="heading" />);
    expect(getByRole('button').getAttribute('data-block-type')).toBe('heading');
  });

  it('throws the precise message outside Editor.Root', () => {
    expect(() => render(<Editor.AddBlock type="heading" />)).toThrow(
      'Editor.AddBlock must be used within an Editor.Root component.',
    );
    expect(() => render(<Editor.OutlineItem blockId="h1" />)).toThrow(
      'Editor.OutlineItem must be used within an Editor.Root component.',
    );
  });
});

describe('stacked form', () => {
  it('recurses useChildren + Editor.Form and grows after add', () => {
    const probe: Probe = { store: null };
    let add: ((type: string) => string | null) | undefined;
    function Actions() {
      const actions = useBlockActions('sec1');
      add = (type) => actions.add(type);
      return null;
    }
    function Stack({ blockId }: { blockId: string }) {
      const children = useChildren(blockId);
      return (
        <>
          <Editor.Form blockId={blockId} />
          {children.map((child) => (
            <Stack key={child.id} blockId={child.id} />
          ))}
        </>
      );
    }
    const { container } = render(
      <Editor.Root schema={storeSchema} defaultValue={makeTree()}>
        <StoreProbe probe={probe} />
        <Actions />
        <Stack blockId="root_1" />
      </Editor.Root>,
    );
    expect(container.querySelectorAll('[data-block-type]')).toHaveLength(4);
    const labels = [...container.querySelectorAll('label')].map(
      (el) => el.textContent,
    );
    expect(labels.filter((text) => text === 'Title')).toHaveLength(2);
    expect(labels).toContain('Text');
    expect(labels).toContain('Level');
    expect(labels).toContain('Body');
    act(() => {
      add?.('paragraph');
    });
    expect(container.querySelectorAll('[data-block-type]')).toHaveLength(5);
  });
});

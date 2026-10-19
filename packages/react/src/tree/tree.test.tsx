import { act, cleanup, fireEvent, render } from '@testing-library/react';
// @vitest-environment happy-dom
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TreeDndOptions, TreeDropInstruction, TreeRow } from './index';

import { Tree } from './index';

afterEach(cleanup);

type Row = TreeRow & { name: string };

function rowsOf(expanded: boolean): Row[] {
  return [
    {
      id: 'a',
      name: 'Alpha',
      parentId: null,
      level: 1,
      posinset: 1,
      setsize: 2,
      hasChildren: true,
      expanded,
    },
    ...(expanded
      ? [
          {
            id: 'a1',
            name: 'Apple',
            parentId: 'a',
            level: 2,
            posinset: 1,
            setsize: 1,
            hasChildren: false,
            expanded: false,
          },
        ]
      : []),
    {
      id: 'b',
      name: 'Beta',
      parentId: null,
      level: 1,
      posinset: 2,
      setsize: 2,
      hasChildren: false,
      expanded: false,
    },
  ];
}

function Harness(props: {
  dnd?: TreeDndOptions;
  dropTarget?: TreeDropInstruction | null;
  initiallyExpanded?: boolean;
  onItemClick?: () => void;
}) {
  const [expanded, setExpanded] = React.useState(
    props.initiallyExpanded ?? false,
  );
  return (
    <Tree.Root
      aria-label="Pages"
      data-testid="tree"
      rows={rowsOf(expanded)}
      getLabel={(row) => row.name}
      onExpandedChange={(_, next) => setExpanded(next)}
      dnd={props.dnd}
      dropTarget={props.dropTarget}
      indicator={<Tree.DropIndicator data-testid="line" />}
    >
      {(row) => (
        <Tree.Item row={row} data-testid={row.id} onClick={props.onItemClick}>
          <Tree.Toggle data-testid={`toggle-${row.id}`} />
          {row.name}
        </Tree.Item>
      )}
    </Tree.Root>
  );
}

const ROW_TYPE = 'application/x-row';

function drag(type: string, target: Element, types = [ROW_TYPE]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    dataTransfer: { types, dropEffect: 'none' },
    clientX: 0,
    clientY: 0,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe('Tree', () => {
  it('renders an APG tree with one tab stop and level variables', () => {
    const { getByTestId, getAllByRole } = render(<Harness initiallyExpanded />);
    const items = getAllByRole('treeitem');
    expect(items.map((i) => i.getAttribute('aria-level'))).toEqual([
      '1',
      '2',
      '1',
    ]);
    expect(items.map((i) => i.tabIndex)).toEqual([0, -1, -1]);
    expect(getByTestId('a').getAttribute('aria-expanded')).toBe('true');
    expect(getByTestId('b').hasAttribute('aria-expanded')).toBe(false);
    expect(getByTestId('a1').style.getPropertyValue('--tree-level')).toBe('1');
    expect(getByTestId('tree').style.getPropertyValue('--tree-indent')).toBe(
      '16px',
    );
  });

  it('moves focus with arrows, expands with Right and type-ahead', () => {
    const { getByTestId } = render(<Harness />);
    act(() => getByTestId('a').focus());
    fireEvent.keyDown(getByTestId('a'), { key: 'ArrowRight' });
    expect(getByTestId('a').getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(getByTestId('a'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(getByTestId('a1'));
    fireEvent.keyDown(getByTestId('a1'), { key: 'b' });
    expect(document.activeElement).toBe(getByTestId('b'));
    expect(getByTestId('b').hasAttribute('data-focused')).toBe(true);
  });

  it('leaves keys the consumer handled alone', () => {
    const { getByTestId } = render(
      <Tree.Root
        rows={rowsOf(false)}
        onKeyDown={(event) => event.preventDefault()}
      >
        {(row) => (
          <Tree.Item row={row} data-testid={row.id}>
            {row.id}
          </Tree.Item>
        )}
      </Tree.Root>,
    );
    act(() => getByTestId('a').focus());
    fireEvent.keyDown(getByTestId('a'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(getByTestId('a'));
  });

  it('toggles without activating the row', () => {
    const onClick = vi.fn();
    const { getByTestId, queryByTestId } = render(
      <Harness onItemClick={onClick} />,
    );
    fireEvent.click(getByTestId('toggle-a'));
    expect(getByTestId('a').getAttribute('aria-expanded')).toBe('true');
    expect(onClick).not.toHaveBeenCalled();
    expect(queryByTestId('toggle-b')).toBeNull();
  });

  it('marks the receiving row and its subtree for an unordered drop', () => {
    const onDrop = vi.fn();
    const { getByTestId } = render(
      <Harness
        initiallyExpanded
        dnd={{ accepts: (dt) => dt.types.includes(ROW_TYPE), onDrop }}
      />,
    );
    drag('dragenter', getByTestId('a'));
    const over = drag('dragover', getByTestId('a'));
    expect(over.defaultPrevented).toBe(true);
    expect(getByTestId('a').hasAttribute('data-drop-target')).toBe(true);
    expect(getByTestId('a1').hasAttribute('data-drop-within')).toBe(true);
    expect(getByTestId('b').hasAttribute('data-drop-within')).toBe(false);
    expect(getByTestId('tree').hasAttribute('data-drag-over')).toBe(true);
    drag('drop', getByTestId('a'));
    expect(onDrop).toHaveBeenCalledWith(
      { parentId: 'a', index: null },
      expect.anything(),
    );
    expect(getByTestId('a').hasAttribute('data-drop-target')).toBe(false);
  });

  it('shows a refused target as blocked and refuses the drop', () => {
    const onDrop = vi.fn();
    const { getByTestId } = render(
      <Harness
        dnd={{
          accepts: () => true,
          canDrop: (target) => target.parentId !== 'b',
          onDrop,
        }}
      />,
    );
    drag('dragenter', getByTestId('b'));
    const over = drag('dragover', getByTestId('b'));
    expect(over.defaultPrevented).toBe(false);
    expect(getByTestId('b').hasAttribute('data-drop-blocked')).toBe(true);
    drag('drop', getByTestId('b'));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('drops into the root level over empty tree space', () => {
    const onDrop = vi.fn();
    const { getByTestId } = render(
      <Harness dnd={{ accepts: () => true, onDrop }} />,
    );
    drag('dragenter', getByTestId('tree'));
    drag('dragover', getByTestId('tree'));
    expect(getByTestId('tree').hasAttribute('data-drop-target')).toBe(true);
    drag('drop', getByTestId('tree'));
    expect(onDrop).toHaveBeenCalledWith(
      { parentId: null, index: null },
      expect.anything(),
    );
  });

  it('ignores drags it does not accept', () => {
    const { getByTestId } = render(
      <Harness dnd={{ accepts: () => false, onDrop: vi.fn() }} />,
    );
    const over = drag('dragover', getByTestId('a'));
    expect(over.defaultPrevented).toBe(false);
    expect(getByTestId('tree').hasAttribute('data-drag-over')).toBe(false);
  });

  it('opens a closed node a drag rests on', () => {
    vi.useFakeTimers();
    const { getByTestId } = render(
      <Harness dnd={{ accepts: () => true, onDrop: vi.fn() }} />,
    );
    drag('dragenter', getByTestId('a'));
    drag('dragover', getByTestId('a'));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(getByTestId('a').getAttribute('aria-expanded')).toBe('true');
    vi.useRealTimers();
  });

  it('draws the line of a controlled ordered drop', () => {
    const { getByTestId, rerender } = render(
      <Harness initiallyExpanded dropTarget={null} />,
    );
    expect(getByTestId('line').hidden).toBe(true);
    const instruction: TreeDropInstruction = {
      kind: 'between',
      parentId: 'a',
      index: 1,
      overId: 'a1',
      line: { rowIndex: 1, edge: 'bottom', level: 2 },
      blocked: false,
    };
    rerender(<Harness initiallyExpanded dropTarget={instruction} />);
    const line = getByTestId('line');
    expect(line.hidden).toBe(false);
    expect(line.getAttribute('data-edge')).toBe('bottom');
    expect(line.getAttribute('data-level')).toBe('2');
    expect(line.style.getPropertyValue('--tree-drop-level')).toBe('1');
    expect(getByTestId('a').hasAttribute('data-drop-target')).toBe(false);
  });
});

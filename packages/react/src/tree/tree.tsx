import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type { TreeDropInstruction, TreeDropTarget } from './core/drop';
import type { TreeRow } from './core/rows';

import { mergeProps, useRender } from '../use-render';
import { dropInstruction, sameDropInstruction } from './core/drop';
import { treeKeyOf, treeNavigate, treeSubtreeRange } from './core/rows';
import {
  createTypeAhead,
  isTypeAheadKey,
  matchTypeAhead,
} from './core/typeahead';

/** Hovering a drag this long over a closed node opens it. */
export const TREE_OPEN_DELAY_MS = 500;
/** How long `data-drop-flash` stays on the receiving row after a drop. */
export const TREE_FLASH_MS = 700;

const ROW_ATTR = 'data-tree-row-id';

export type TreeDndOptions = {
  /**
   * Whether a drag is meant for this tree, from its types (the payload is
   * unreadable before the drop). Other drags pass through untouched.
   */
  accepts: (dataTransfer: DataTransfer) => boolean;
  /** Siblings keep a user-defined order: a drop line shows between rows. @default false */
  ordered?: boolean;
  /** Share of a row's height at its top and bottom that drops next to it. @default 0.25 */
  edge?: number;
  /** Whether a row can take children. @default every row */
  canContain?: (row: TreeRow) => boolean;
  /** Validates a target; a refused one shows as blocked. @default every target */
  canDrop?: (target: TreeDropTarget, dataTransfer: DataTransfer) => boolean;
  onDrop: (target: TreeDropTarget, event: React.DragEvent) => void;
  /** `dropEffect` while over a valid target. @default 'move' */
  dropEffect?: (dataTransfer: DataTransfer) => DataTransfer['dropEffect'];
  /** Opens a closed node a drag rests on; `0` turns it off. @default 500 */
  openDelay?: number;
};

type TreeContextValue = {
  rows: readonly TreeRow[];
  indexById: ReadonlyMap<string, number>;
  focusId: string | null;
  setFocusId: (id: string) => void;
  onExpandedChange?: (id: string, expanded: boolean) => void;
  drop: TreeDropInstruction | null;
  /** Rows of the receiving node while a drop marks a node, not a line. */
  dropRange: { start: number; end: number } | null;
  flashId: string | null;
  rootRef: React.RefObject<HTMLElement | null>;
};

const TreeContext = React.createContext<TreeContextValue | null>(null);
/** The row of the enclosing `Tree.Item`. */
export const TreeRowContext = React.createContext<TreeRow | null>(null);

function useTree(part: string): TreeContextValue {
  const value = React.useContext(TreeContext);
  if (!value) throw new Error(`${part} must be used within a Tree.Root.`);
  return value;
}

function useRow(part: string): TreeRow {
  const value = React.useContext(TreeRowContext);
  if (!value) throw new Error(`${part} must be used within a Tree.Item.`);
  return value;
}

function reducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** The active drop of the enclosing `Tree.Root`, for custom indicators. */
export function useTreeDrop(): TreeDropInstruction | null {
  return useTree('useTreeDrop').drop;
}

export type TreeRootState = {
  /** The root level receives the current drag. */
  dropTarget: boolean;
  /** A drag the tree accepts is over it. */
  dragOver: boolean;
};

export type TreeRootProps<TRow extends TreeRow> = Omit<
  UseRenderComponentProps<'div', TreeRootState>,
  'children' | 'onDrop'
> & {
  /** The visible rows in display order. */
  rows: readonly TRow[];
  children: (row: TRow) => React.ReactNode;
  /** Rendered inside the tree after the rows, usually `Tree.DropIndicator`. */
  indicator?: React.ReactNode;
  /** Indentation per level in px, exposed as `--tree-indent`. @default 16 */
  indent?: number;
  /** The row that takes Tab focus until the user focuses one. @default the first row */
  defaultFocusId?: string | null;
  /** The focused row, controlled. */
  focusId?: string | null;
  onFocusIdChange?: (id: string) => void;
  /** Expanding or collapsing a row (keys, `Tree.Toggle`, a drag resting on it). */
  onExpandedChange?: (id: string, expanded: boolean) => void;
  /** Row labels for type-ahead; without it typing does nothing. */
  getLabel?: (row: TRow) => string;
  /** Native drag and drop onto the rows. */
  dnd?: TreeDndOptions;
  /**
   * The drop to show, for drags the tree does not see as native events
   * (a pointer-driven session). Overrides the native drop while set.
   */
  dropTarget?: TreeDropInstruction | null;
};

/**
 * An APG tree (`role="tree"`) over flat rows. Up/Down move, Right opens or
 * enters, Left closes or goes to the parent, Home/End, `*` opens the
 * siblings, typing jumps by label; Right and Left swap under `dir="rtl"`.
 * Keys the consumer handles first (`onKeyDown` with `preventDefault`) are
 * left alone.
 *
 * With `dnd`, native drags over the rows resolve to a drop instruction
 * (`dropInstruction`): the edges of a row drop next to it, its middle into
 * it, the end of a subtree picks the level by the pointer's inline
 * offset, empty space drops into the root level. Ordered trees draw
 * `Tree.DropIndicator`; unordered trees mark the receiving node and its
 * visible subtree (`data-drop-target`, `data-drop-within`).
 */
export function TreeRoot<TRow extends TreeRow>(props: TreeRootProps<TRow>) {
  const {
    rows,
    children,
    indicator,
    indent = 16,
    defaultFocusId,
    focusId: controlledFocus,
    onFocusIdChange,
    onExpandedChange,
    getLabel,
    dnd,
    dropTarget,
    render,
    ...rest
  } = props;
  const [innerFocus, setInnerFocus] = React.useState<string | null>(null);
  const focusId = controlledFocus !== undefined ? controlledFocus : innerFocus;
  const focusChangeRef = React.useRef(onFocusIdChange);
  focusChangeRef.current = onFocusIdChange;
  const setFocusId = React.useCallback((id: string) => {
    setInnerFocus(id);
    focusChangeRef.current?.(id);
  }, []);
  const [nativeDrop, setNativeDrop] =
    React.useState<TreeDropInstruction | null>(null);
  const [flashId, setFlashId] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLElement | null>(null);
  const typeAhead = React.useRef(createTypeAhead());
  const pendingFocus = React.useRef(false);
  const depth = React.useRef(0);
  const dwell = React.useRef<{ id: string; timer: number } | null>(null);
  const dndRef = React.useRef(dnd);
  dndRef.current = dnd;
  const expandRef = React.useRef(onExpandedChange);
  expandRef.current = onExpandedChange;

  const indexById = React.useMemo(
    () => new Map(rows.map((row, index) => [row.id, index])),
    [rows],
  );
  const effectiveFocus =
    focusId !== null && indexById.has(focusId)
      ? focusId
      : defaultFocusId != null && indexById.has(defaultFocusId)
        ? defaultFocusId
        : (rows[0]?.id ?? null);

  React.useEffect(() => {
    if (!pendingFocus.current || !effectiveFocus) return;
    pendingFocus.current = false;
    rootRef.current
      ?.querySelector<HTMLElement>(
        `[${ROW_ATTR}="${CSS.escape(effectiveFocus)}"]`,
      )
      ?.focus();
  });

  const stopDwell = () => {
    if (dwell.current) clearTimeout(dwell.current.timer);
    dwell.current = null;
  };
  const endDrag = React.useCallback(() => {
    depth.current = 0;
    if (dwell.current) clearTimeout(dwell.current.timer);
    dwell.current = null;
    setNativeDrop(null);
  }, []);
  React.useEffect(() => {
    if (!nativeDrop) return;
    // A drag cancelled or dropped elsewhere does not always leave the tree.
    window.addEventListener('dragend', endDrag);
    window.addEventListener('drop', endDrag);
    return () => {
      window.removeEventListener('dragend', endDrag);
      window.removeEventListener('drop', endDrag);
    };
  }, [nativeDrop, endDrag]);
  React.useEffect(() => stopDwell, []);

  const isRtl = () =>
    rootRef.current?.closest('[dir]')?.getAttribute('dir') === 'rtl';

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!effectiveFocus) return;
    const target = event.target as Element;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) {
      return;
    }
    let key = treeKeyOf(event.key);
    if (key === 'left' && isRtl()) key = 'right';
    else if (key === 'right' && isRtl()) key = 'left';
    if (key) {
      event.preventDefault();
      const result = treeNavigate(rows, effectiveFocus, key);
      for (const id of result.expand ?? []) onExpandedChange?.(id, true);
      if (result.collapse) onExpandedChange?.(result.collapse, false);
      if (result.focus) {
        pendingFocus.current = true;
        setFocusId(result.focus);
      }
      return;
    }
    if (
      getLabel &&
      isTypeAheadKey(event.key, {
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
      })
    ) {
      const search = typeAhead.current.push(event.key, event.timeStamp);
      const from = indexById.get(effectiveFocus) ?? -1;
      const match = matchTypeAhead(rows.map(getLabel), from, search);
      if (match !== -1) {
        pendingFocus.current = true;
        setFocusId(rows[match].id);
      }
    }
  };

  /** The instruction for a native drag event, or `null` when not ours. */
  const resolve = (event: React.DragEvent): TreeDropInstruction | null => {
    const options = dndRef.current;
    if (!options || !options.accepts(event.dataTransfer)) return null;
    const root = rootRef.current;
    const rowEl = (event.target as Element | null)?.closest?.(`[${ROW_ATTR}]`);
    const id =
      rowEl && root?.contains(rowEl) ? rowEl.getAttribute(ROW_ATTR) : null;
    const index = id === null ? -1 : (indexById.get(id) ?? -1);
    let x = 0;
    let y = 0.5;
    if (rowEl && index !== -1) {
      const rect = rowEl.getBoundingClientRect();
      y = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
      x = isRtl() ? rect.right - event.clientX : event.clientX - rect.left;
    }
    return dropInstruction({
      rows,
      index,
      x,
      y,
      indent,
      ordered: options.ordered,
      edge: options.edge,
      canContain: options.canContain,
      canDrop: options.canDrop
        ? (target) => options.canDrop!(target, event.dataTransfer)
        : undefined,
    });
  };

  const dwellOn = (instruction: TreeDropInstruction) => {
    const delay = dndRef.current?.openDelay ?? TREE_OPEN_DELAY_MS;
    const id = instruction.kind === 'inside' ? instruction.overId : null;
    const row = id === null ? undefined : rows[indexById.get(id) ?? -1];
    if (!row || !row.hasChildren || row.expanded || delay <= 0) {
      stopDwell();
      return;
    }
    if (dwell.current?.id === row.id) return;
    stopDwell();
    dwell.current = {
      id: row.id,
      timer: window.setTimeout(() => {
        dwell.current = null;
        expandRef.current?.(row.id, true);
      }, delay),
    };
  };

  const dragProps: Pick<
    React.HTMLAttributes<HTMLElement>,
    'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'
  > = {
    onDragEnter: (event) => {
      if (!dndRef.current?.accepts(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      depth.current += 1;
    },
    onDragOver: (event) => {
      const instruction = resolve(event);
      if (!instruction) return;
      event.stopPropagation();
      if (!instruction.blocked) {
        event.preventDefault();
        event.dataTransfer.dropEffect =
          dndRef.current?.dropEffect?.(event.dataTransfer) ?? 'move';
      }
      dwellOn(instruction);
      setNativeDrop((current) =>
        sameDropInstruction(current, instruction) ? current : instruction,
      );
    },
    onDragLeave: (event) => {
      if (!dndRef.current?.accepts(event.dataTransfer)) return;
      event.stopPropagation();
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) endDrag();
    },
    onDrop: (event) => {
      const instruction = resolve(event);
      endDrag();
      if (!instruction || instruction.blocked) return;
      event.preventDefault();
      event.stopPropagation();
      dndRef.current?.onDrop(
        { parentId: instruction.parentId, index: instruction.index },
        event,
      );
      if (instruction.parentId !== null && !reducedMotion()) {
        const flashed = instruction.parentId;
        setFlashId(flashed);
        window.setTimeout(
          () => setFlashId((current) => (current === flashed ? null : current)),
          TREE_FLASH_MS,
        );
      }
    },
  };

  const drop = dropTarget !== undefined ? dropTarget : nativeDrop;
  const dropRange = React.useMemo(
    () =>
      drop && !drop.blocked && !drop.line
        ? treeSubtreeRange(rows, drop.parentId)
        : null,
    [rows, drop],
  );

  const contextValue = React.useMemo<TreeContextValue>(
    () => ({
      rows,
      indexById,
      focusId: effectiveFocus,
      setFocusId,
      onExpandedChange,
      drop,
      dropRange,
      flashId,
      rootRef,
    }),
    [
      rows,
      indexById,
      effectiveFocus,
      setFocusId,
      onExpandedChange,
      drop,
      dropRange,
      flashId,
    ],
  );

  const element = useRender({
    defaultTagName: 'div',
    render,
    state: {
      dropTarget: !!drop && !drop.blocked && drop.parentId === null,
      dragOver: !!drop,
    } satisfies TreeRootState,
    props: mergeProps<'div'>(
      {
        ref: rootRef,
        role: 'tree',
        style: {
          position: 'relative',
          '--tree-indent': `${indent}px`,
        } as React.CSSProperties,
      },
      dnd ? dragProps : undefined,
      { onKeyDown },
      rest,
      {
        children: (
          <>
            {rows.map((row) => (
              <React.Fragment key={row.id}>{children(row)}</React.Fragment>
            ))}
            {indicator}
          </>
        ),
      },
    ),
  });
  return (
    <TreeContext.Provider value={contextValue}>{element}</TreeContext.Provider>
  );
}

export type TreeItemState = {
  focused: boolean;
  expanded: boolean;
  level: number;
  /** This row receives the drag (dropped into it). */
  dropTarget: boolean;
  /** This row lies inside the receiving node's subtree (unordered trees). */
  dropWithin: boolean;
  /** The drag over this row points at a refused target. */
  dropBlocked: boolean;
  /** Briefly true on the row that received a drop (off with `prefers-reduced-motion`). */
  dropFlash: boolean;
};

export type TreeItemProps = UseRenderComponentProps<'div', TreeItemState> & {
  row: TreeRow;
};

/**
 * The props and state of a tree row, for parts that render a `treeitem`
 * of their own (wrap it in `TreeRowContext` so `Tree.Toggle` finds it).
 */
export function useTreeItem(row: TreeRow): {
  props: React.ComponentPropsWithRef<'div'>;
  state: TreeItemState;
} {
  const tree = useTree('Tree.Item');
  const index = tree.indexById.get(row.id) ?? -1;
  const drop = tree.drop;
  const receiving =
    !!drop &&
    !drop.blocked &&
    drop.parentId === row.id &&
    (drop.kind === 'inside' || !drop.line);
  const within =
    !!tree.dropRange &&
    index > tree.dropRange.start &&
    index <= tree.dropRange.end;
  const setFocusId = tree.setFocusId;
  return {
    state: {
      focused: tree.focusId === row.id,
      expanded: row.expanded,
      level: row.level,
      dropTarget: receiving,
      dropWithin: within,
      dropBlocked: !!drop && drop.blocked && drop.overId === row.id,
      dropFlash: tree.flashId === row.id,
    },
    props: {
      role: 'treeitem',
      'aria-level': row.level,
      'aria-setsize': row.setsize,
      'aria-posinset': row.posinset,
      'aria-expanded': row.hasChildren ? row.expanded : undefined,
      tabIndex: tree.focusId === row.id ? 0 : -1,
      [ROW_ATTR]: row.id,
      style: { '--tree-level': row.level - 1 } as React.CSSProperties,
      onFocus: (event: React.FocusEvent) => {
        if (event.target === event.currentTarget) setFocusId(row.id);
      },
      onMouseDown: () => setFocusId(row.id),
    } as React.ComponentPropsWithRef<'div'>,
  };
}

/**
 * One `treeitem` with `aria-level`, `aria-setsize`, `aria-posinset` and
 * `aria-expanded` (rows that may have children); the focused row is the
 * tree's single tab stop. Exposes its depth as `--tree-level` (0 on the
 * root level), so `padding-inline-start: calc(var(--tree-indent) *
 * var(--tree-level))` indents it.
 */
export function TreeItem(props: TreeItemProps) {
  const { row, render, ...rest } = props;
  const item = useTreeItem(row);
  const element = useRender({
    defaultTagName: 'div',
    render,
    state: item.state,
    props: mergeProps<'div'>(item.props, rest),
  });
  return (
    <TreeRowContext.Provider value={row}>{element}</TreeRowContext.Provider>
  );
}

export type TreeToggleProps = UseRenderComponentProps<
  'span',
  { expanded: boolean }
>;

/**
 * The disclosure icon of a `Tree.Item`: a click expands or collapses the
 * row without activating it. Decorative (the item carries
 * `aria-expanded`); renders nothing for rows without children.
 */
export function TreeToggle(props: TreeToggleProps) {
  const { render, ...rest } = props;
  const tree = useTree('Tree.Toggle');
  const row = useRow('Tree.Toggle');
  const element = useRender({
    defaultTagName: 'span',
    render,
    state: { expanded: row.expanded },
    props: mergeProps<'span'>(
      {
        'aria-hidden': true,
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation();
          tree.onExpandedChange?.(row.id, !row.expanded);
        },
      },
      rest,
    ),
  });
  return row.hasChildren ? element : null;
}

export type TreeDropIndicatorState = {
  edge: 'top' | 'bottom';
  level: number;
  blocked: boolean;
};

export type TreeDropIndicatorProps = UseRenderComponentProps<
  'div',
  TreeDropIndicatorState
>;

/**
 * The drop line of an ordered tree: absolutely positioned on the edge of
 * the row it touches and indented to the level the dropped node takes
 * (`inset-inline-start: calc(var(--tree-indent) * var(--tree-drop-level))`).
 * Stays `hidden` while no line is due. Pass it as `Tree.Root`'s
 * `indicator`.
 */
export function TreeDropIndicator(props: TreeDropIndicatorProps) {
  const { render, style, ...rest } = props;
  const tree = useTree('Tree.DropIndicator');
  const line = tree.drop?.line ?? null;
  const rowId = line ? (tree.rows[line.rowIndex]?.id ?? null) : null;
  const ownRef = React.useRef<HTMLDivElement | null>(null);
  const [top, setTop] = React.useState<number | null>(null);

  // Measured from the indicator's own element: the tree's ref is re-attached
  // after its children's layout effects run.
  React.useLayoutEffect(() => {
    const root = ownRef.current?.closest<HTMLElement>('[role="tree"]');
    const rowEl =
      line && rowId && root
        ? root.querySelector<HTMLElement>(
            `[${ROW_ATTR}="${CSS.escape(rowId)}"]`,
          )
        : null;
    if (!line || !root || !rowEl) {
      setTop(null);
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const rect = rowEl.getBoundingClientRect();
    const edgeY = line.edge === 'top' ? rect.top : rect.bottom;
    setTop(edgeY - rootRect.top + root.scrollTop - root.clientTop);
  }, [line, rowId]);

  const shown = line !== null && top !== null;
  return useRender({
    defaultTagName: 'div',
    render,
    state: {
      edge: line?.edge ?? 'bottom',
      level: line?.level ?? 1,
      blocked: tree.drop?.blocked ?? false,
    } satisfies TreeDropIndicatorState,
    props: mergeProps<'div'>(
      {
        ref: ownRef,
        'aria-hidden': true,
        hidden: !shown,
        style: {
          position: 'absolute',
          pointerEvents: 'none',
          top: top ?? 0,
          insetInlineStart: 'calc(var(--tree-indent) * var(--tree-drop-level))',
          insetInlineEnd: 0,
          display: shown ? undefined : 'none',
          '--tree-drop-level': (line?.level ?? 1) - 1,
          ...style,
        } as React.CSSProperties,
      },
      rest,
    ),
  });
}

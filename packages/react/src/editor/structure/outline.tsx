import * as React from 'react';

import type { TreeDropInstruction } from '../../tree/core';
import type { SlotRef } from '../core/document';
import type { AnyEditorSchema } from '../core/schema';
import type { EditorNodes } from '../core/store';
import type { OutlineRow } from './outline-rows';
import type {
  EditorOutlineItemProps,
  EditorOutlineProps,
  OutlineItemState,
} from './types';

import { Tree, TreeRowContext, useTreeItem } from '../../tree';
import { dropInstruction, sameDropInstruction } from '../../tree/core';
import { composeRefs, mergeProps, useRender } from '../../use-render';
import { describeBlock } from '../announcer';
import {
  useDocSelector,
  useEphemeralSelector,
  useSessionSelector,
} from '../binding';
import { useEditorContext } from '../context';
import { slotsOf } from '../core/schema';
import { outlineCanContain, outlineDropTarget } from './outline-drag';
import { useOutlineRows } from './outline-rows';

const TreeRoot = Tree.Root;
const ROW_ATTR = 'data-tree-row-id';
/** Pointer travel before a press on a row becomes a drag. */
const DRAG_START_PX = 5;
/** Resting on a collapsed row this long during a drag opens it. */
const DWELL_MS = 500;
const NO_ROW_DRAG =
  'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"])';
const EDITABLE = 'input, textarea, select, [contenteditable="true"]';

/** A slot's label: its `label`, else its name. */
function slotLabelOf(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  blockId: string,
  slot: string,
): string {
  const node = nodes[blockId];
  return (node && slotsOf(schema, node.type)[slot]?.label) || slot;
}

/** The text a row shows and type-ahead matches. */
function rowLabelOf(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  row: OutlineRow,
): string {
  if (row.kind === 'slot') {
    return slotLabelOf(schema, nodes, row.blockId, row.slot);
  }
  const node = nodes[row.id];
  return node ? describeBlock(schema, node).label : row.type;
}

/**
 * The outline: an APG tree (`@createcms/react/tree`) over flat rows, one
 * per visible block and one per labelled slot. Up/Down select the next
 * block, Right and Left open, close and walk the levels, Home/End, `*`,
 * type-ahead; Alt+Up/Down move the block among its siblings, Delete and
 * Backspace remove it (after `onDelete`), Escape clears the selection.
 * Rows drag with the pointer: the edges of a row drop next to it, its
 * middle into it, the end of a group moves out by the pointer's inline
 * offset; a target the placement rules refuse shows as blocked and drops
 * nothing.
 */
export function EditorOutline(props: EditorOutlineProps) {
  const {
    children = (row: OutlineRow) => <EditorOutlineItem row={row} />,
    indicator,
    indent = 16,
    rows: givenRows,
    range,
    reveal,
    slotRows,
    onDelete,
    onKeyDown,
    onPointerDown,
    render,
    ref,
    ...rest
  } = props;
  const { messages, store, schema, announcer, dir } =
    useEditorContext('Editor.Outline');
  const ownRows = useOutlineRows({ slotRows });
  const rows = givenRows ?? ownRows;
  const rowsRef = React.useRef(rows);
  rowsRef.current = rows;
  const options = React.useMemo(() => ({ slotRows }), [slotRows]);
  const treeRef = React.useRef<HTMLElement | null>(null);
  const primary = useSessionSelector((s) => s.selection[0] ?? null);
  const [focusId, setFocusId] = React.useState<string | null>(primary);
  const [drop, setDrop] = React.useState<TreeDropInstruction | null>(null);
  const revealRef = React.useRef(reveal);
  revealRef.current = reveal;

  const findRow = (id: string) =>
    treeRef.current?.querySelector<HTMLElement>(
      `[${ROW_ATTR}="${CSS.escape(id)}"]`,
    ) ?? null;

  /** The row to focus after the next render (a move or removal re-renders the rows). */
  const pendingFocus = React.useRef<string | null>(null);
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  React.useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    pendingFocus.current = null;
    const el = findRow(id);
    if (el) {
      el.focus();
      return;
    }
    revealRef.current?.(id);
    let tries = 0;
    const retry = () => {
      const mounted = findRow(id);
      if (mounted) mounted.focus();
      else if ((tries += 1) < 10) requestAnimationFrame(retry);
    };
    requestAnimationFrame(retry);
  });

  /** Moves the tab stop (and the selection, for a block) to `id` and focuses it. */
  const land = (id: string) => {
    pendingFocus.current = id;
    rerender();
    setFocusId(id);
    const row = rowsRef.current.find((candidate) => candidate.id === id);
    if (row?.kind === 'node') store.select(id);
  };

  // A selection made elsewhere (canvas, form) moves the tab stop and
  // scrolls its row into view without taking focus from where the user is.
  React.useEffect(() => {
    if (primary === null) return;
    setFocusId(primary);
    const tree = treeRef.current;
    if (!tree) return;
    const active = tree.ownerDocument.activeElement;
    if (active && tree.contains(active)) return;
    const el = findRow(primary);
    if (el) el.scrollIntoView?.({ block: 'nearest' });
    else revealRef.current?.(primary);
  }, [primary]);

  // Key navigation selects the block it lands on; focus alone (Tab into
  // the tree, a press) does not, clicks select through the row.
  const navigating = React.useRef(false);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    navigating.current = true;
    queueMicrotask(() => {
      navigating.current = false;
    });
    const target = event.target as Element;
    if (target.closest(EDITABLE)) return;
    const id = target.closest(`[${ROW_ATTR}]`)?.getAttribute(ROW_ATTR);
    const index = rows.findIndex((row) => row.id === id);
    const row = rows[index];
    if (!row) return;
    const mod = event.metaKey || event.ctrlKey;
    const back = (event.key === 'ArrowLeft') !== (dir === 'rtl');
    if (
      row.kind === 'slot' &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
      back &&
      !mod &&
      !event.altKey
    ) {
      // Slot rows never collapse: Left goes straight to their block.
      event.preventDefault();
      if (row.parentId !== null) land(row.parentId);
      return;
    }
    if (row.kind !== 'node') return;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!event.altKey || mod) return;
        event.preventDefault();
        const { parent } = row;
        const siblings = store.getDoc().nodes[parent.id]?.slots[parent.slot];
        const at = siblings?.indexOf(row.id) ?? -1;
        const to = event.key === 'ArrowUp' ? at - 1 : at + 1;
        if (at < 0 || to < 0 || to >= (siblings?.length ?? 0)) return;
        if (store.move(row.id, { parent, index: to })) land(row.id);
        return;
      }
      case 'Delete':
      case 'Backspace': {
        event.preventDefault();
        if (onDelete?.(row.id) === false) return;
        let end = index;
        while (rows[end + 1] && rows[end + 1]!.level > row.level) end += 1;
        const next =
          rows.slice(end + 1).find((r) => r.kind === 'node') ??
          rows
            .slice(0, index)
            .reverse()
            .find((r) => r.kind === 'node');
        if (!store.remove(row.id)) return;
        if (next) land(next.id);
        else store.select(null);
        return;
      }
      case 'Escape': {
        event.preventDefault();
        store.select(null);
        return;
      }
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerDown?.(event);
    if (event.defaultPrevented || event.button !== 0) return;
    const tree = treeRef.current;
    const target = event.target as Element;
    const rowEl = target.closest<HTMLElement>(`[${ROW_ATTR}]`);
    if (!tree || !rowEl || !tree.contains(rowEl)) return;
    if (target.closest(NO_ROW_DRAG)) return;
    const draggedId = rowEl.getAttribute(ROW_ATTR);
    const dragged = rowsRef.current.find((row) => row.id === draggedId);
    if (!draggedId || dragged?.kind !== 'node') return;
    const doc = tree.ownerDocument;
    const view = doc.defaultView;
    const origin = { x: event.clientX, y: event.clientY };
    const rootStyle = doc.documentElement.style;
    const userSelect = rootStyle.getPropertyValue('user-select');
    const webkitUserSelect = rootStyle.getPropertyValue('-webkit-user-select');
    let active = false;
    let pending: { parent: SlotRef; index: number } | null = null;
    let shown: TreeDropInstruction | null = null;
    let dwell: { id: string; timer: ReturnType<typeof setTimeout> } | null =
      null;

    const clearDwell = () => {
      if (dwell) clearTimeout(dwell.timer);
      dwell = null;
    };
    const show = (next: TreeDropInstruction | null) => {
      if (sameDropInstruction(shown, next)) return;
      shown = next;
      setDrop(next);
    };

    const onMove = (move: PointerEvent) => {
      if (!active) {
        if (
          Math.hypot(move.clientX - origin.x, move.clientY - origin.y) <
          DRAG_START_PX
        ) {
          return;
        }
        active = true;
        rowEl.setAttribute('data-dragging', '');
        tree.setAttribute('data-dragging', '');
        // A row drag never selects text: drop what the press began and
        // keep the moving pointer from extending it.
        rootStyle.setProperty('user-select', 'none');
        rootStyle.setProperty('-webkit-user-select', 'none');
        doc.getSelection()?.removeAllRanges();
      }
      const current = rowsRef.current;
      const hit = doc.elementFromPoint(move.clientX, move.clientY);
      if (!hit || !tree.contains(hit)) {
        pending = null;
        clearDwell();
        show(null);
        return;
      }
      const overEl = hit.closest<HTMLElement>(`[${ROW_ATTR}]`);
      const overId = overEl?.getAttribute(ROW_ATTR) ?? null;
      const index =
        overId === null ? -1 : current.findIndex((row) => row.id === overId);
      let x = 0;
      let y = 0.5;
      if (overEl && index !== -1) {
        const rect = overEl.getBoundingClientRect();
        y = rect.height > 0 ? (move.clientY - rect.top) / rect.height : 0.5;
        x =
          dir === 'rtl' ? rect.right - move.clientX : move.clientX - rect.left;
      }
      const { nodes, rootId } = store.getDoc();
      const resolve = (target: {
        parentId: string | null;
        index: number | null;
      }) =>
        outlineDropTarget(
          schema,
          nodes,
          rootId,
          current,
          draggedId,
          target,
          options,
        );
      const instruction = dropInstruction({
        rows: current,
        index,
        x,
        y,
        indent,
        ordered: true,
        canContain: (row) =>
          outlineCanContain(schema, nodes, row as OutlineRow, options),
        canDrop: (target) => resolve(target) !== null,
      });
      pending = instruction.blocked ? null : resolve(instruction);
      show(instruction);
      // A collapsed row opens when the pointer rests on its middle.
      const over = index === -1 ? undefined : current[index];
      if (
        instruction.kind === 'inside' &&
        over?.kind === 'node' &&
        over.hasChildren &&
        !over.expanded
      ) {
        if (dwell?.id !== over.id) {
          clearDwell();
          const id = over.id;
          dwell = {
            id,
            timer: setTimeout(() => store.setCollapsed(id, false), DWELL_MS),
          };
        }
      } else {
        clearDwell();
      }
    };

    const end = (commit: boolean) => {
      doc.removeEventListener('pointermove', onMove, true);
      doc.removeEventListener('selectstart', onSelectStart, true);
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('keydown', onKey, true);
      view?.removeEventListener('blur', onBlur);
      clearDwell();
      rowEl.removeAttribute('data-dragging');
      tree.removeAttribute('data-dragging');
      if (active) {
        rootStyle.setProperty('user-select', userSelect);
        rootStyle.setProperty('-webkit-user-select', webkitUserSelect);
      }
      show(null);
      const landing = pending;
      if (!commit || !active || !landing) return;
      const { nodes, rootId } = store.getDoc();
      const from = nodes[draggedId]?.parent;
      const fromIndex = from
        ? (nodes[from.id]?.slots[from.slot]?.indexOf(draggedId) ?? -1)
        : -1;
      const sameSlot =
        from?.id === landing.parent.id && from?.slot === landing.parent.slot;
      const index =
        sameSlot && fromIndex >= 0 && fromIndex < landing.index
          ? landing.index - 1
          : landing.index;
      if (!store.move(draggedId, { parent: landing.parent, index })) return;
      store.select(draggedId);
      const moved = nodes[draggedId];
      const parentNode = nodes[landing.parent.id];
      if (moved) {
        announcer.announce(
          messages.announce.dragDropped({
            block: describeBlock(schema, moved),
            position: index + 1,
            parent:
              landing.parent.id === rootId || !parentNode
                ? messages.announce.root
                : describeBlock(schema, parentNode).label,
          }),
        );
      }
    };
    const onUp = () => end(true);
    const onBlur = () => end(false);
    const onSelectStart = (select: Event) => {
      if (active) select.preventDefault();
    };
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== 'Escape' || !active) return;
      key.preventDefault();
      key.stopPropagation();
      end(false);
    };
    doc.addEventListener('pointermove', onMove, true);
    doc.addEventListener('selectstart', onSelectStart, true);
    doc.addEventListener('pointerup', onUp, true);
    doc.addEventListener('keydown', onKey, true);
    view?.addEventListener('blur', onBlur);
  };

  const getLabel = React.useCallback(
    (row: OutlineRow) => rowLabelOf(schema, store.getDoc().nodes, row),
    [schema, store],
  );

  return (
    <TreeRoot<OutlineRow>
      rows={rows}
      indent={indent}
      focusId={focusId}
      onFocusIdChange={(id) => {
        setFocusId(id);
        if (!navigating.current) return;
        const row = rowsRef.current.find((candidate) => candidate.id === id);
        if (row?.kind === 'node') store.select(id);
      }}
      onExpandedChange={(id, expanded) => {
        const row = rowsRef.current.find((candidate) => candidate.id === id);
        if (row?.kind === 'node') store.setCollapsed(id, !expanded);
      }}
      getLabel={getLabel}
      dropTarget={drop}
      range={range}
      reveal={reveal}
      indicator={indicator}
      render={render}
      aria-label={messages.parts.outline}
      aria-multiselectable
      {...rest}
      ref={composeRefs(treeRef, ref)}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
    >
      {children}
    </TreeRoot>
  );
}

/**
 * One outline row: a `treeitem` for a block (selected on click, hovered
 * with the pointer, `aria-selected`) or for a slot label. Children
 * replace its default content, the block label or the slot label; render
 * `Editor.OutlineToggle` inside it for the disclosure.
 */
export function EditorOutlineItem(props: EditorOutlineItemProps) {
  const {
    row,
    render,
    children,
    onClick,
    onPointerEnter,
    onPointerLeave,
    ...rest
  } = props;
  const { store, schema } = useEditorContext('Editor.OutlineItem');
  const blockId = row.kind === 'node' ? row.id : row.blockId;
  const selected = useSessionSelector(
    (s) => row.kind === 'node' && s.selection.includes(row.id),
  );
  const hovered = useEphemeralSelector(
    (s) => row.kind === 'node' && s.hoverId === row.id,
  );
  const blockType = useDocSelector((s) => s.nodes[blockId]?.type ?? 'unknown');
  const label = useDocSelector((s) => rowLabelOf(schema, s.nodes, row));
  const item = useTreeItem(row);
  const state: OutlineItemState = {
    ...item.state,
    kind: row.kind,
    selected,
    hovered,
    blockId,
    blockType,
    slotName: row.kind === 'node' ? row.parent.slot : row.slot,
  };
  const element = useRender<'div', OutlineItemState>({
    defaultTagName: 'div',
    render,
    state,
    props: mergeProps<'div'>(
      item.props,
      {
        'aria-selected': selected,
        children: children ?? label,
      },
      rest,
      {
        onClick: (event: React.MouseEvent<HTMLDivElement>) => {
          onClick?.(event);
          if (event.defaultPrevented || row.kind !== 'node') return;
          if ((event.target as Element).closest(EDITABLE)) return;
          store.select(row.id);
        },
        onPointerEnter: (event: React.PointerEvent<HTMLDivElement>) => {
          onPointerEnter?.(event);
          if (row.kind === 'node') store.hover(row.id);
        },
        onPointerLeave: (event: React.PointerEvent<HTMLDivElement>) => {
          onPointerLeave?.(event);
          if (row.kind === 'node' && store.getEphemeral().hoverId === row.id) {
            store.hover(null);
          }
        },
      },
    ),
  });
  return (
    <TreeRowContext.Provider value={row}>{element}</TreeRowContext.Provider>
  );
}

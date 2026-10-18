import * as React from 'react';

import type { SlotRef } from '../core/document';
import type { EditorNodes } from '../core/store';
import type {
  AddBlockState,
  EditorAddBlockProps,
  EditorOutlineGroupProps,
  EditorOutlineProps,
  EditorOutlineItemProps,
  OutlineGroupState,
  OutlineItemState,
} from './types';

import { composeRefs, useRender } from '../../use-render';
import { describeBlock } from '../announcer';
import {
  useDocSelector,
  useEphemeralSelector,
  useSessionSelector,
} from '../binding';
import { useEditorContext } from '../context';
import {
  canPlaceIn,
  DEFAULT_SLOT,
  isSelfOrDescendant,
  slotsOf,
} from '../core/schema';
import { useBlockActions } from '../hooks';
import { insertPointFor } from './insert-point';
import { instructionTarget, treeInstruction } from './outline-drag';

const TREE_ITEM = '[role="treeitem"]';
const TYPEAHEAD_MS = 500;

/** Every tree item of the enclosing tree (or document) in DOM order. */
function treeItemsAround(el: HTMLElement): HTMLElement[] {
  const scope = el.closest('[role="tree"]') ?? el.ownerDocument;
  return Array.from(scope.querySelectorAll<HTMLElement>(TREE_ITEM));
}

/** The item's nearest ancestor item, or `null` at the top level. */
function parentItemOf(el: HTMLElement): HTMLElement | null {
  return el.parentElement?.closest<HTMLElement>(TREE_ITEM) ?? null;
}

/** Items not hidden inside a collapsed ancestor item. */
function visibleItemsAround(el: HTMLElement): HTMLElement[] {
  return treeItemsAround(el).filter((item) => {
    for (let up = parentItemOf(item); up; up = parentItemOf(up)) {
      if (up.getAttribute('aria-expanded') === 'false') return false;
    }
    return true;
  });
}

/** The item's own text: its `aria-label`, else its text outside nested items. */
function itemText(el: HTMLElement): string {
  const label = el.getAttribute('aria-label');
  if (label) return label;
  let text = '';
  const walker = el.ownerDocument.createTreeWalker(el, 4);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(TREE_ITEM) === el) {
      text += node.textContent ?? '';
    }
  }
  return text.trim();
}

const typeahead = new WeakMap<object, { text: string; at: number }>();

/**
 * The item to land on after removing `el`: the next item outside `el`'s
 * subtree, else the previous one.
 */
function neighbourOf(el: HTMLElement): HTMLElement | null {
  const items = visibleItemsAround(el);
  const at = items.indexOf(el);
  if (at === -1) return null;
  for (let i = at + 1; i < items.length; i++) {
    const candidate = items[i];
    if (candidate && !el.contains(candidate)) return candidate;
  }
  for (let i = at - 1; i >= 0; i--) {
    const candidate = items[i];
    if (candidate && !el.contains(candidate)) return candidate;
  }
  return null;
}

function depthOf(nodes: EditorNodes, id: string): number {
  let depth = 0;
  let current = nodes[id];
  while (current && current.parent !== null) {
    depth += 1;
    current = nodes[current.parent.id];
  }
  return depth;
}

/**
 * The outline's tree container: `role="tree"` named from the catalog (or
 * `aria-label`). Render the root's rows inside it.
 */
const DRAG_START_PX = 5;
const DWELL_MS = 500;
const NO_ROW_DRAG =
  'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"])';

type OutlineIndicator = {
  readonly kind: 'line' | 'box';
  readonly top: number;
  readonly left: number;
  readonly height: number;
};

/** The row's own box, without the rows nested inside it. */
function ownRect(row: HTMLElement): DOMRect {
  const rect = row.getBoundingClientRect();
  const nested = row.querySelector(TREE_ITEM);
  if (!nested) return rect;
  const bottom = nested.getBoundingClientRect().top;
  return new DOMRect(rect.x, rect.y, rect.width, Math.max(0, bottom - rect.y));
}

/**
 * The outline's tree container: `role="tree"` named from the catalog (or
 * `aria-label`). Rows drag to reorder, nest (middle of a row) and move
 * out (left of the last row of a group, by `indent` per level); a
 * collapsed row opens after hovering it for 500 ms. Render the root's
 * rows inside it.
 */
/** Navigation over a flat outline's rows, for rows that are not mounted. */
type OutlineNav = {
  readonly rows: readonly string[];
  readonly reveal: ((id: string) => void) | undefined;
  readonly tree: React.RefObject<HTMLDivElement | null>;
};

const OutlineNavContext = React.createContext<OutlineNav | null>(null);

export function EditorOutline(props: EditorOutlineProps) {
  const { render, indent = 16, style, ref, rows, reveal, ...rest } = props;
  const { messages, store, schema, announcer } =
    useEditorContext('Editor.Outline');
  const treeRef = React.useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = React.useState<OutlineIndicator | null>(
    null,
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    rest.onPointerDown?.(event);
    if (event.defaultPrevented || event.button !== 0) return;
    const tree = treeRef.current;
    const target = event.target as Element;
    const row = target.closest<HTMLElement>(TREE_ITEM);
    if (!tree || !row || !tree.contains(row)) return;
    if (target.closest(NO_ROW_DRAG)) return;
    const draggedId = row.dataset.blockId;
    if (!draggedId) return;
    const doc = tree.ownerDocument;
    const view = doc.defaultView;
    const origin = { x: event.clientX, y: event.clientY };
    let active = false;
    let drop: { parent: SlotRef; index: number } | null = null;
    let dwell: { id: string; timer: ReturnType<typeof setTimeout> } | null =
      null;

    const clearDwell = () => {
      if (dwell) clearTimeout(dwell.timer);
      dwell = null;
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
        row.setAttribute('data-dragging', '');
      }
      const over = doc
        .elementFromPoint(move.clientX, move.clientY)
        ?.closest<HTMLElement>(TREE_ITEM);
      const overId = over?.dataset.blockId;
      if (!over || !overId || !tree.contains(over)) {
        drop = null;
        clearDwell();
        setIndicator(null);
        return;
      }
      const { nodes } = store.getDoc();
      const node = nodes[overId];
      const parent = node?.parent ?? null;
      const siblings = parent
        ? (nodes[parent.id]?.slots[parent.slot] ?? [])
        : [];
      const level = Number(over.getAttribute('aria-level') ?? '1');
      const rect = ownRect(over);
      const treeRect = tree.getBoundingClientRect();
      const instruction = treeInstruction(
        { x: treeRect.x, y: rect.y, width: rect.width, height: rect.height },
        { x: move.clientX, y: move.clientY },
        {
          level,
          indent,
          canMakeChild: node
            ? Object.keys(slotsOf(schema, node.type)).length > 0
            : false,
          isLastInGroup: siblings[siblings.length - 1] === overId,
        },
      );
      drop = instructionTarget(schema, nodes, overId, draggedId, instruction);
      // A collapsed row opens when the pointer rests on its middle.
      if (
        instruction.type === 'make-child' &&
        over.getAttribute('aria-expanded') === 'false'
      ) {
        if (dwell?.id !== overId) {
          clearDwell();
          dwell = {
            id: overId,
            timer: setTimeout(
              () => store.setCollapsed(overId, false),
              DWELL_MS,
            ),
          };
        }
      } else {
        clearDwell();
      }
      if (!drop) {
        setIndicator(null);
        return;
      }
      const top = rect.y - treeRect.y + tree.scrollTop;
      const depth =
        instruction.type === 'make-child'
          ? level
          : instruction.type === 'reparent'
            ? instruction.level - 1
            : level - 1;
      setIndicator(
        instruction.type === 'make-child'
          ? { kind: 'box', top, left: depth * indent, height: rect.height }
          : {
              kind: 'line',
              top:
                instruction.type === 'reorder-above'
                  ? top
                  : over.getBoundingClientRect().bottom -
                    treeRect.y +
                    tree.scrollTop,
              left: depth * indent,
              height: 2,
            },
      );
    };

    const end = (commit: boolean) => {
      doc.removeEventListener('pointermove', onMove, true);
      doc.removeEventListener('pointerup', onUp, true);
      doc.removeEventListener('keydown', onKey, true);
      view?.removeEventListener('blur', onBlur);
      clearDwell();
      row.removeAttribute('data-dragging');
      setIndicator(null);
      if (!commit || !active || !drop) return;
      const { nodes, rootId } = store.getDoc();
      const from = nodes[draggedId]?.parent;
      const fromIndex = from
        ? (nodes[from.id]?.slots[from.slot]?.indexOf(draggedId) ?? -1)
        : -1;
      const sameSlot =
        from?.id === drop.parent.id && from?.slot === drop.parent.slot;
      const index =
        sameSlot && fromIndex >= 0 && fromIndex < drop.index
          ? drop.index - 1
          : drop.index;
      if (!store.move(draggedId, { parent: drop.parent, index })) return;
      store.select(draggedId);
      const moved = nodes[draggedId];
      const parentNode = nodes[drop.parent.id];
      if (moved) {
        announcer.announce(
          messages.announce.dragDropped({
            block: describeBlock(schema, moved),
            position: index + 1,
            parent:
              drop.parent.id === rootId || !parentNode
                ? messages.announce.root
                : describeBlock(schema, parentNode).label,
          }),
        );
      }
    };
    const onUp = () => end(true);
    const onBlur = () => end(false);
    const onKey = (key: KeyboardEvent) => {
      if (key.key !== 'Escape' || !active) return;
      key.preventDefault();
      key.stopPropagation();
      end(false);
    };
    doc.addEventListener('pointermove', onMove, true);
    doc.addEventListener('pointerup', onUp, true);
    doc.addEventListener('keydown', onKey, true);
    view?.addEventListener('blur', onBlur);
  };

  const nav = React.useMemo<OutlineNav | null>(
    () => (rows ? { rows, reveal, tree: treeRef } : null),
    [rows, reveal],
  );

  const tree = useRender<'div'>({
    defaultTagName: 'div',
    props: {
      role: 'tree',
      'aria-label': messages.parts.outline,
      'aria-multiselectable': true,
      ...rest,
      ref: composeRefs(treeRef, ref),
      style: { position: 'relative', ...style },
      onPointerDown,
      children: (
        <>
          {rest.children}
          {indicator ? (
            <div
              aria-hidden
              data-editor-outline-drop-indicator=""
              data-variant={indicator.kind}
              style={{
                position: 'absolute',
                pointerEvents: 'none',
                top: indicator.top,
                left: indicator.left,
                right: 0,
                height: indicator.height,
              }}
            />
          ) : null}
        </>
      ),
    },
    render,
  });
  return (
    <OutlineNavContext.Provider value={nav}>{tree}</OutlineNavContext.Provider>
  );
}

export function EditorOutlineItem(props: EditorOutlineItemProps) {
  const {
    blockId,
    onDelete,
    render,
    onClick,
    onKeyDown,
    onPointerEnter,
    onPointerLeave,
    ...rest
  } = props;
  const ctx = useEditorContext('Editor.OutlineItem');
  const actions = useBlockActions(blockId);
  const selection = useSessionSelector((state) => state.selection);
  const collapsed = useSessionSelector((state) =>
    state.collapsed.includes(blockId),
  );
  const hovered = useEphemeralSelector((state) => state.hoverId === blockId);
  const slice = useDocSelector(
    (state) => {
      const node = state.nodes[blockId];
      const rootChildren = state.nodes[state.rootId]?.slots[DEFAULT_SLOT] ?? [];
      const siblings = node?.parent
        ? (state.nodes[node.parent.id]?.slots[node.parent.slot] ?? [])
        : [];
      return {
        type: node?.type ?? null,
        parentId: node?.parent?.id ?? null,
        hasChildren: node
          ? Object.values(node.slots).some((ids) => ids.length > 0)
          : false,
        depth: node ? depthOf(state.nodes, blockId) : 0,
        posInSet: siblings.indexOf(blockId) + 1,
        setSize: siblings.length,
        firstOfRoot: rootChildren[0] === blockId,
      };
    },
    (a, b) =>
      a.type === b.type &&
      a.parentId === b.parentId &&
      a.hasChildren === b.hasChildren &&
      a.depth === b.depth &&
      a.posInSet === b.posInSet &&
      a.setSize === b.setSize &&
      a.firstOfRoot === b.firstOfRoot,
  );
  const selected = selection.includes(blockId);
  const primary = selection[0] === blockId;
  const tabStop = primary || (selection.length === 0 && slice.firstOfRoot);
  const expanded = slice.hasChildren && !collapsed;

  /**
   * True when the event originates in THIS row, not in a nested row (rows
   * nest in the DOM) and not in an editable element inside the row.
   */
  const ownsEvent = (event: React.SyntheticEvent<HTMLDivElement>) => {
    const target = event.target as Element | null;
    if (!target) return false;
    if (target.closest('[role="treeitem"]') !== event.currentTarget) {
      return false;
    }
    return !target.closest('input, textarea, select, [contenteditable="true"]');
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || !ownsEvent(event)) return;
    ctx.store.select(blockId);
  };

  const elRef = React.useRef<HTMLDivElement | null>(null);
  const refocus = React.useRef(false);
  // A reordered row is moved in the DOM; browsers may drop its focus, so it
  // is restored after the commit that moved it.
  React.useLayoutEffect(() => {
    if (refocus.current) {
      refocus.current = false;
      elRef.current?.focus();
    }
  });

  // A selection made elsewhere (canvas, preview) scrolls the row into view
  // without taking focus from where the user is.
  React.useEffect(() => {
    const el = elRef.current;
    if (!primary || !el) return;
    const tree = el.closest('[role="tree"]');
    const active = el.ownerDocument.activeElement;
    if (tree && active && tree.contains(active)) return;
    el.scrollIntoView?.({ block: 'nearest' });
  }, [primary]);

  const nav = React.useContext(OutlineNavContext);
  const land = (target: HTMLElement | null | undefined) => {
    const targetId = target?.dataset.blockId;
    if (!target || !targetId) return;
    ctx.store.select(targetId);
    target.focus();
  };
  /** Flat outlines: select `id`, scroll it in, focus its row once mounted. */
  const landId = (id: string | undefined) => {
    if (!id || !nav) return;
    ctx.store.select(id);
    nav.reveal?.(id);
    let tries = 0;
    const focus = () => {
      const row = nav.tree.current?.querySelector<HTMLElement>(
        `[role="treeitem"][data-block-id="${CSS.escape(id)}"]`,
      );
      if (row) row.focus();
      else if ((tries += 1) < 10) requestAnimationFrame(focus);
    };
    focus();
  };
  /** Flat outlines: the visible row ids, with this row's index. */
  const flat = () => {
    const ids = nav?.rows ?? [];
    return { ids, at: ids.indexOf(blockId) };
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !ownsEvent(event)) return;
    const el = event.currentTarget;
    const mod = event.metaKey || event.ctrlKey;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        if (mod) return;
        event.preventDefault();
        if (event.altKey) {
          const moved =
            event.key === 'ArrowUp' ? actions.moveUp() : actions.moveDown();
          if (moved) refocus.current = true;
          return;
        }
        if (nav) {
          const { ids, at } = flat();
          landId(ids[event.key === 'ArrowUp' ? at - 1 : at + 1]);
          return;
        }
        const items = visibleItemsAround(el);
        const at = items.indexOf(el);
        land(items[event.key === 'ArrowUp' ? at - 1 : at + 1]);
        return;
      }
      case 'ArrowRight':
      case 'ArrowLeft': {
        if (mod || event.altKey) return;
        event.preventDefault();
        const rtl = ctx.dir === 'rtl';
        const opening = (event.key === 'ArrowRight') !== rtl;
        if (opening) {
          if (!slice.hasChildren) return;
          if (collapsed) {
            ctx.store.setCollapsed(blockId, false);
            return;
          }
          if (nav) {
            const { ids, at } = flat();
            const next = ids[at + 1];
            if (
              next &&
              ctx.store.getDoc().nodes[next]?.parent?.id === blockId
            ) {
              landId(next);
            }
            return;
          }
          const items = visibleItemsAround(el);
          const next = items[items.indexOf(el) + 1];
          if (next && el.contains(next)) land(next);
          return;
        }
        if (expanded) {
          ctx.store.setCollapsed(blockId, true);
          return;
        }
        if (nav) {
          const doc = ctx.store.getDoc();
          const parent = doc.nodes[blockId]?.parent?.id;
          if (parent && parent !== doc.rootId) landId(parent);
          return;
        }
        land(parentItemOf(el));
        return;
      }
      case 'Home':
      case 'End': {
        event.preventDefault();
        if (nav) {
          const { ids } = flat();
          landId(event.key === 'Home' ? ids[0] : ids[ids.length - 1]);
          return;
        }
        const items = visibleItemsAround(el);
        land(event.key === 'Home' ? items[0] : items[items.length - 1]);
        return;
      }
      case '*': {
        event.preventDefault();
        const nodes = ctx.store.getDoc().nodes;
        const at = nodes[blockId]?.parent ?? null;
        const siblings = at ? (nodes[at.id]?.slots[at.slot] ?? []) : [];
        for (const id of siblings) ctx.store.setCollapsed(id, false);
        return;
      }
      case 'Delete':
      case 'Backspace': {
        event.preventDefault();
        if (onDelete?.(blockId) === false) return;
        if (nav) {
          const { ids, at } = flat();
          const nodes = ctx.store.getDoc().nodes;
          const outside = (id: string) =>
            !isSelfOrDescendant(nodes, blockId, id);
          const next =
            ids.slice(at + 1).find(outside) ??
            ids.slice(0, at).reverse().find(outside);
          if (!actions.remove()) return;
          if (next) landId(next);
          else ctx.store.select(null);
          return;
        }
        const neighbour = neighbourOf(el);
        const neighbourId = neighbour?.dataset.blockId ?? null;
        if (!actions.remove()) return;
        ctx.store.select(neighbourId);
        neighbour?.focus();
        return;
      }
      case 'Escape': {
        event.preventDefault();
        ctx.store.select(null);
        return;
      }
      default: {
        if (mod || event.altKey || event.key.length !== 1) return;
        if (event.key === ' ') return;
        const tree = el.closest('[role="tree"]') ?? el.ownerDocument;
        const now = Date.now();
        const last = typeahead.get(tree);
        const text =
          (last && now - last.at < TYPEAHEAD_MS ? last.text : '') +
          event.key.toLowerCase();
        typeahead.set(tree, { text, at: now });
        if (nav) {
          const { ids, at } = flat();
          const doc = ctx.store.getDoc();
          const start = text.length === 1 ? at + 1 : at;
          const ordered = [...ids.slice(start), ...ids.slice(0, start)];
          const match = ordered.find((id) => {
            const node = doc.nodes[id];
            return node
              ? describeBlock(ctx.schema, node)
                  .label.toLowerCase()
                  .startsWith(text)
              : false;
          });
          if (match) {
            event.preventDefault();
            landId(match);
          }
          return;
        }
        const items = visibleItemsAround(el);
        const at = items.indexOf(el);
        // A repeated first letter cycles; a longer prefix keeps the match.
        const start = text.length === 1 ? at + 1 : at;
        const ordered = [...items.slice(start), ...items.slice(0, start)];
        const match = ordered.find((item) =>
          itemText(item).toLowerCase().startsWith(text),
        );
        if (match) {
          event.preventDefault();
          land(match);
        }
      }
    }
  };

  const element = useRender<'div', OutlineItemState>({
    defaultTagName: 'div',
    props: {
      role: 'treeitem',
      'aria-selected': selected,
      'aria-level': Math.max(slice.depth, 1),
      'aria-expanded': slice.hasChildren ? expanded : undefined,
      'aria-setsize': slice.setSize || undefined,
      'aria-posinset': slice.posInSet || undefined,
      tabIndex: tabStop ? 0 : -1,
      ref: elRef,
      onClick: handleClick,
      onKeyDown: handleKeyDown,
      onPointerEnter: (event: React.PointerEvent<HTMLDivElement>) => {
        onPointerEnter?.(event);
        if (ownsEvent(event)) ctx.store.hover(blockId);
      },
      onPointerLeave: (event: React.PointerEvent<HTMLDivElement>) => {
        onPointerLeave?.(event);
        if (ctx.store.getEphemeral().hoverId === blockId) {
          ctx.store.hover(null);
        }
      },
      ...rest,
    },
    render,
    state: {
      selected,
      depth: slice.depth,
      hasChildren: slice.hasChildren,
      expanded,
      hovered,
      blockId,
      blockType: slice.type ?? 'unknown',
    },
  });
  return slice.type === null ? null : element;
}

export function EditorAddBlock(props: EditorAddBlockProps) {
  const { type, parentId, slot, index, render, onClick, children, ...rest } =
    props;
  const ctx = useEditorContext('Editor.AddBlock');
  const selected = useSessionSelector((state) => state.selection[0] ?? null);
  const target = useDocSelector(
    (state) => {
      if (parentId !== undefined) {
        const parent = { id: parentId, slot: slot ?? DEFAULT_SLOT };
        return {
          parent,
          index,
          allowed: canPlaceIn(ctx.schema, state.nodes, type, parent).ok,
        };
      }
      const point = insertPointFor(
        ctx.schema,
        state.nodes,
        state.rootId,
        selected,
        type,
      );
      return { ...point, index: index ?? point.index };
    },
    (a, b) =>
      a.parent.id === b.parent.id &&
      a.parent.slot === b.parent.slot &&
      a.index === b.index &&
      a.allowed === b.allowed,
  );
  const label = children ?? ctx.schema.components[type]?.label ?? type;
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    const id = ctx.store.add(type, {
      parent: target.parent,
      index: target.index,
    });
    if (id) ctx.store.select(id);
  };
  return useRender<'button', AddBlockState>({
    defaultTagName: 'button',
    props: {
      type: 'button',
      disabled: !target.allowed,
      onClick: handleClick,
      children: label,
      ...rest,
    },
    render,
    state: { blockType: type },
  });
}

/**
 * Groups the outline rows of one slot of a block: `role="group"` labelled
 * by the slot's `label` (or its name). Render it per slot when a block has
 * more than one.
 */
export function EditorOutlineGroup(props: EditorOutlineGroupProps) {
  const { blockId, slot, render, ...rest } = props;
  const ctx = useEditorContext('Editor.OutlineGroup');
  const label = useDocSelector((state) => {
    const node = state.nodes[blockId];
    if (!node) return slot;
    return slotsOf(ctx.schema, node.type)[slot]?.label ?? slot;
  });
  return useRender<'div', OutlineGroupState>({
    defaultTagName: 'div',
    props: { role: 'group', 'aria-label': label, ...rest },
    render,
    state: { slot, blockId },
  });
}

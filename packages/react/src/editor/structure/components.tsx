import * as React from 'react';

import type { EditorNodes } from '../core/store';
import type {
  AddBlockState,
  EditorAddBlockProps,
  EditorOutlineGroupProps,
  EditorOutlineItemProps,
  OutlineGroupState,
  OutlineItemState,
} from './types';

import { useRender } from '../../use-render';
import { useEditorSelector } from '../binding';
import { useEditorContext } from '../context';
import { canPlaceIn, DEFAULT_SLOT, slotsOf } from '../core/schema';
import { useBlockActions } from '../hooks';
import { insertPointFor } from './insert-point';

const TREE_ITEM = '[role="treeitem"]';

/** Every tree item of the enclosing tree (or document) in DOM order. */
function treeItemsAround(el: HTMLElement): HTMLElement[] {
  const scope = el.closest('[role="tree"]') ?? el.ownerDocument;
  return Array.from(scope.querySelectorAll<HTMLElement>(TREE_ITEM));
}

/**
 * The item to land on after removing `el`: the next item outside `el`'s
 * subtree, else the previous one.
 */
function neighbourOf(el: HTMLElement): HTMLElement | null {
  const items = treeItemsAround(el);
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

export function EditorOutlineItem(props: EditorOutlineItemProps) {
  const { blockId, onDelete, render, onClick, onKeyDown, ...rest } = props;
  const ctx = useEditorContext('Editor.OutlineItem');
  const actions = useBlockActions(blockId);
  const slice = useEditorSelector((state) => {
    const node = state.nodes[blockId];
    const selection = state.selection[ctx.userId];
    const rootChildren = state.nodes[state.rootId]?.slots[DEFAULT_SLOT] ?? [];
    return {
      type: node?.type ?? null,
      hasChildren: node
        ? Object.values(node.slots).some((ids) => ids.length > 0)
        : false,
      depth: node ? depthOf(state.nodes, blockId) : 0,
      selected: selection?.selected === blockId,
      nothingSelected: !selection || selection.selected === null,
      firstOfRoot: rootChildren[0] === blockId,
    };
  });
  const tabStop =
    slice.selected || (slice.nothingSelected && slice.firstOfRoot);

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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !ownsEvent(event)) return;
    const el = event.currentTarget;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        event.preventDefault();
        if (event.altKey) {
          const moved =
            event.key === 'ArrowUp' ? actions.moveUp() : actions.moveDown();
          if (moved) refocus.current = true;
          return;
        }
        const items = treeItemsAround(el);
        const at = items.indexOf(el);
        const target = items[event.key === 'ArrowUp' ? at - 1 : at + 1];
        const targetId = target?.dataset.blockId;
        if (target && targetId) {
          ctx.store.select(targetId);
          target.focus();
        }
        return;
      }
      case 'Delete':
      case 'Backspace': {
        event.preventDefault();
        if (onDelete?.(blockId) === false) return;
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
      default:
        return;
    }
  };

  const element = useRender<'div', OutlineItemState>({
    defaultTagName: 'div',
    props: {
      role: 'treeitem',
      'aria-selected': slice.selected,
      'aria-level': Math.max(slice.depth, 1),
      'aria-expanded': slice.hasChildren ? true : undefined,
      tabIndex: tabStop ? 0 : -1,
      ref: elRef,
      onClick: handleClick,
      onKeyDown: handleKeyDown,
      ...rest,
    },
    render,
    state: {
      selected: slice.selected,
      depth: slice.depth,
      hasChildren: slice.hasChildren,
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
  const target = useEditorSelector(
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
        state.selection[ctx.userId]?.selected ?? null,
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
  const label = useEditorSelector((state) => {
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

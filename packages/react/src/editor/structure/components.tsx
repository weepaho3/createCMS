import * as React from 'react';

import type { EditorNodes } from '../store';
import type {
  AddBlockState,
  EditorAddBlockProps,
  EditorOutlineItemProps,
  OutlineItemState,
} from './types';

import { useRender } from '../../use-render';
import { useEditorSelector } from '../binding';
import { useEditorContext } from '../context';
import { placementOf, useBlockActions } from '../hooks';
import { canPlace } from '../schema';

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
  while (current && current.parentId !== null) {
    depth += 1;
    current = nodes[current.parentId];
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
    const rootChildren = state.nodes[state.rootId]?.childIds ?? [];
    return {
      type: node?.type ?? null,
      hasChildren: (node?.childIds.length ?? 0) > 0,
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
  const { type, parentId, index, render, onClick, children, ...rest } = props;
  const ctx = useEditorContext('Editor.AddBlock');
  const placement = placementOf(ctx.schema);
  const target = useEditorSelector((state) => {
    if (parentId !== undefined) {
      const parent = state.nodes[parentId];
      return { parentId, parentType: parent?.type ?? null, index };
    }
    const selectedId = state.selection[ctx.userId]?.selected ?? null;
    const selected = selectedId === null ? null : state.nodes[selectedId];
    if (selected && canPlace(placement, type, selected.type)) {
      return {
        parentId: selected.id,
        parentType: selected.type,
        index,
      };
    }
    if (selected && selected.parentId !== null) {
      const parent = state.nodes[selected.parentId];
      const at = parent ? parent.childIds.indexOf(selected.id) + 1 : undefined;
      return {
        parentId: selected.parentId,
        parentType: parent?.type ?? null,
        index: index ?? at,
      };
    }
    return { parentId: state.rootId, parentType: 'root', index };
  });
  const disabled =
    target.parentType === null || !canPlace(placement, type, target.parentType);
  const label = children ?? ctx.schema.blocks?.[type]?.label ?? type;
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    const id = ctx.store.add(type, {
      parentId: target.parentId,
      index: target.index,
    });
    if (id) ctx.store.select(id);
  };
  return useRender<'button', AddBlockState>({
    defaultTagName: 'button',
    props: {
      type: 'button',
      disabled,
      onClick: handleClick,
      children: label,
      ...rest,
    },
    render,
    state: { blockType: type },
  });
}

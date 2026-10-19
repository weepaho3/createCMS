import * as React from 'react';

import type { AddBlockState, EditorAddBlockProps } from './types';

import { useRender } from '../../use-render';
import { useDocSelector, useSessionSelector } from '../binding';
import { useEditorContext } from '../context';
import { canPlaceIn, DEFAULT_SLOT } from '../core/schema';
import { insertPointFor } from './insert-point';

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

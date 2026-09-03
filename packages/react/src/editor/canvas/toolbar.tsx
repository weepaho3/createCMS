import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { InsertTarget } from './insert';

import { useRender } from '../../use-render';
import { useEditorSelector } from '../binding';
import { useEditorContext } from '../context';
import { placementOf, useBlockActions } from '../hooks';
import { canPlace } from '../schema';
import { useCanvasContext } from './context';
import {
  parentTypeOf,
  resolveInsertAt,
  type InsertOrientation,
} from './insert';
import { createInsertAdapters } from './insert-dom';
import { useBlockRect } from './rects';

const subscribeNoop = () => () => {};

function sameTarget(a: InsertTarget, b: InsertTarget): boolean {
  const ar = a.rect;
  const br = b.rect;
  return (
    a.parentId === b.parentId &&
    a.index === b.index &&
    ar.x === br.x &&
    ar.y === br.y &&
    ar.width === br.width &&
    ar.height === br.height
  );
}

export function useInsertTarget(options?: {
  type?: string;
  draggedId?: string;
}): InsertTarget | null {
  const canvas = useCanvasContext('useInsertTarget');
  const { schema, userId } = useEditorContext('useInsertTarget');
  const rootId = useEditorSelector((s) => s.rootId);
  const nodes = useEditorSelector((s) => s.nodes);
  const hovered = useEditorSelector(
    (s) => s.selection[userId]?.hovered ?? null,
  );

  const placement = placementOf(schema);
  const { measurer, host, pointer, interactive, dragging, editing } = canvas;
  const pointerSnap = React.useSyncExternalStore(
    pointer ? pointer.subscribe : subscribeNoop,
    () => (pointer ? pointer.getSnapshot() : null),
    () => null,
  );

  const prevRef = React.useRef<InsertTarget | null>(null);

  if (
    interactive !== 'edit' ||
    dragging ||
    editing ||
    hovered === null ||
    pointerSnap === null ||
    !measurer ||
    !host
  ) {
    prevRef.current = null;
    return null;
  }

  const adapters = createInsertAdapters(host, measurer, nodes, rootId);

  const next = resolveInsertAt(
    nodes,
    placement,
    rootId,
    hovered,
    pointerSnap.x,
    pointerSnap.y,
    {
      draggedType: options?.type,
      draggedId: options?.draggedId,
      getRect: adapters.getRect,
      isRowFlow: adapters.isRowFlow,
    },
  );

  if (next === null) {
    prevRef.current = null;
    return null;
  }

  const prev = prevRef.current;
  if (prev && sameTarget(prev, next)) return prev;
  prevRef.current = next;
  return next;
}

/** True when a DragHandle is rendered inside BlockToolbar (in-flow). */
export const BlockToolbarContext = React.createContext(false);

type BlockToolbarState = {
  editorBlockToolbar: boolean;
  side: 'top' | 'bottom';
  blockType: string | null;
};

export type CanvasBlockToolbarProps = React.ComponentPropsWithRef<'div'> & {
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'bottom';
  offset?: number;
  render?: UseRenderComponentProps<'div', BlockToolbarState>['render'];
};

export function CanvasBlockToolbar({
  align = 'start',
  side = 'top',
  offset = 0,
  children,
  render,
  style,
  ...rest
}: CanvasBlockToolbarProps) {
  const canvas = useCanvasContext('Canvas.BlockToolbar');
  const { userId } = useEditorContext('Canvas.BlockToolbar');
  const selected = useEditorSelector(
    (s) => s.selection[userId]?.selected ?? null,
  );
  const node = useEditorSelector((s) =>
    selected ? (s.nodes[selected] ?? null) : null,
  );
  const rect = useBlockRect(selected ?? '');

  if (
    !canvas.host ||
    canvas.interactive === 'none' ||
    selected === null ||
    rect === null
  ) {
    return null;
  }

  const alignStyle: React.CSSProperties =
    align === 'center'
      ? { left: '50%', transform: 'translateX(-50%)' }
      : align === 'end'
        ? { right: 0 }
        : { left: 0 };

  const sideStyle: React.CSSProperties =
    side === 'bottom'
      ? { top: '100%', marginTop: offset }
      : { bottom: '100%', marginBottom: offset };

  const chrome = useRender<'div', BlockToolbarState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      role: 'toolbar',
      style: {
        position: 'absolute',
        pointerEvents: 'auto',
        ...sideStyle,
        ...alignStyle,
        ...style,
      },
      children,
    },
    state: {
      editorBlockToolbar: true,
      side,
      blockType: node?.type ?? null,
    },
  });

  return (
    <div
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        boxSizing: 'border-box',
        pointerEvents: 'none',
      }}
    >
      <BlockToolbarContext.Provider value={true}>
        {chrome}
      </BlockToolbarContext.Provider>
    </div>
  );
}

type InsertButtonState = {
  editorInsertButton: boolean;
  orientation: InsertOrientation;
  emptyContainer: boolean;
  allowedChildTypes?: string[];
};

export type CanvasInsertButtonProps = Omit<
  React.ComponentPropsWithRef<'button'>,
  'type'
> & {
  placement: 'between' | 'container';
  type?: string;
  onInsert?: (target: InsertTarget) => void;
  render?: UseRenderComponentProps<'button', InsertButtonState>['render'];
};

export function CanvasInsertButton({
  placement,
  type,
  onInsert,
  onClick,
  render,
  style,
  children,
  ...rest
}: CanvasInsertButtonProps) {
  useCanvasContext('Canvas.InsertButton');
  const ctx = useEditorContext('Canvas.InsertButton');
  const target = useInsertTarget();
  const rootId = useEditorSelector((s) => s.rootId);
  const nodes = useEditorSelector((s) => s.nodes);
  const actions = useBlockActions(target?.parentId ?? '');
  const placementIndex = placementOf(ctx.schema);

  if (target === null) return null;
  if (placement === 'between' && target.variant !== 'line') return null;
  if (placement === 'container' && target.variant !== 'box') return null;

  const pType = parentTypeOf(nodes, rootId, target.parentId);
  const disabled =
    type !== undefined &&
    (pType === null ||
      !canPlace(placementIndex, type, pType) ||
      nodes[target.parentId] === undefined);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (type) {
      ctx.store.add(type, {
        parentId: target.parentId,
        index: target.index,
      });
    } else {
      onInsert?.(target);
    }
  };

  const allowedTypes = [...actions.allowedChildTypes];

  return useRender<'button', InsertButtonState>({
    defaultTagName: 'button',
    render,
    props: {
      type: 'button',
      disabled,
      onClick: handleClick,
      ...rest,
      style: {
        position: 'absolute',
        left: target.rect.x + target.rect.width / 2,
        top: target.rect.y + target.rect.height / 2,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'auto',
        ...style,
      },
      children,
    },
    state: {
      editorInsertButton: true,
      orientation: target.orientation,
      emptyContainer: target.variant === 'box',
      allowedChildTypes: allowedTypes,
    },
  });
}

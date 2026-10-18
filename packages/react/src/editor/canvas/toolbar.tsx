import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { FieldRef } from '../core/store';

import { composeRefs, useRender } from '../../use-render';
import {
  useDocSelector,
  useSessionSelector,
  useEphemeralSelector,
} from '../binding';
import { useEditorContext } from '../context';
import { canPlaceIn } from '../core/schema';
import { isHTMLElement } from '../dom';
import { useRovingFocus } from '../roving';
import { useCanvasContext } from './context';
import {
  type InsertTarget,
  resolveInsertAt,
  type InsertOrientation,
} from './insert';
import { createInsertAdapters } from './insert-dom';
import {
  overlayChromeFitsAbove,
  overlayChromeFitsBelow,
  visibleIntersection,
} from './rect';
import { useBlockRect, useHostViewBox } from './rects';

const subscribeNoop = () => () => {};

function sameTarget(a: InsertTarget, b: InsertTarget): boolean {
  const ar = a.rect;
  const br = b.rect;
  return (
    a.parent.id === b.parent.id &&
    a.parent.slot === b.parent.slot &&
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
  const { schema } = useEditorContext('useInsertTarget');
  const rootId = useDocSelector((s) => s.rootId);
  const nodes = useDocSelector((s) => s.nodes);
  const hovered = useEphemeralSelector((s) => s.hoverId);

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
    schema,
    nodes,
    rootId,
    hovered,
    pointerSnap.x,
    pointerSnap.y,
    {
      draggedType: options?.type,
      draggedId: options?.draggedId,
      getRect: adapters.getRect,
      getSlotRect: adapters.getSlotRect,
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
  /** `start` and `end` follow `Editor.Root`'s `dir`. */
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
  ref,
  onKeyDown,
  onFocus,
  ...rest
}: CanvasBlockToolbarProps) {
  const canvas = useCanvasContext('Canvas.BlockToolbar');
  const { dir, store, schema, messages } = useEditorContext(
    'Canvas.BlockToolbar',
  );
  const roving = useRovingFocus<HTMLDivElement>({ dir });
  // Where Alt+F10 came from, so Escape can return there.
  const returnRef = React.useRef<{
    el: HTMLElement | null;
    editing: FieldRef | null;
  } | null>(null);
  const selected = useSessionSelector((s) => s.selection[0] ?? null);
  const node = useDocSelector((s) =>
    selected ? (s.nodes[selected] ?? null) : null,
  );
  const rect = useBlockRect(selected ?? '');
  const view = useHostViewBox(canvas.host);

  const active =
    Boolean(canvas.host) &&
    canvas.interactive !== 'none' &&
    selected !== null &&
    rect !== null;
  const frameRect = rect ?? { x: 0, y: 0, width: 0, height: 0 };

  const vis = visibleIntersection(frameRect, view) ?? frameRect;

  // `start`/`end` follow the editor's text direction.
  const rtl = dir === 'rtl';
  const alignStyle: React.CSSProperties =
    align === 'center'
      ? { left: '50%', transform: 'translateX(-50%)' }
      : (align === 'end') !== rtl
        ? { right: 0 }
        : { left: 0 };

  const fitsOutside =
    side === 'bottom'
      ? overlayChromeFitsBelow(frameRect, view, offset)
      : overlayChromeFitsAbove(frameRect, view, offset);

  const sideStyle: React.CSSProperties = fitsOutside
    ? side === 'bottom'
      ? { top: '100%', marginTop: offset }
      : { bottom: '100%', marginBottom: offset }
    : { top: offset, marginTop: 0 };

  const rovingFocus = roving.focus;
  React.useEffect(
    () =>
      store.on('ui', ({ action }) => {
        if (action !== 'toolbar') return;
        const active = canvas.host?.ownerDocument.activeElement ?? null;
        returnRef.current = {
          el: isHTMLElement(active) ? active : null,
          editing: store.getSession().editing,
        };
        rovingFocus();
      }),
    [store, canvas.host, rovingFocus],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      const back = returnRef.current;
      returnRef.current = null;
      event.preventDefault();
      if (back?.el?.isConnected) back.el.focus();
      else if (back?.editing) {
        store.focus(back.editing);
        store.setEditing(back.editing);
      } else canvas.host?.focus();
      return;
    }
    roving.onKeyDown(event);
  };

  const blockLabel = node
    ? (schema.components[node.type]?.label ?? node.type)
    : '';

  const chrome = useRender<'div', BlockToolbarState>({
    defaultTagName: 'div',
    render,
    props: {
      'aria-label': messages.parts.blockToolbar({ label: blockLabel }),
      ...rest,
      ref: composeRefs(roving.ref, ref),
      onKeyDown: handleKeyDown,
      onFocus: (event: React.FocusEvent<HTMLDivElement>) => {
        onFocus?.(event);
        roving.onFocus(event);
      },
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

  if (!active) return null;
  const frame = fitsOutside ? frameRect : vis;

  return (
    <div
      style={{
        position: 'absolute',
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
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
  const refused = useDocSelector(
    (s) =>
      target !== null &&
      type !== undefined &&
      !canPlaceIn(ctx.schema, s.nodes, type, target.parent).ok,
  );

  const active =
    target !== null &&
    (placement === 'between'
      ? target.variant === 'line'
      : target.variant === 'box');

  const disabled = refused;

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (target === null) return;
    onClick?.(event);
    if (event.defaultPrevented) return;
    if (type) {
      ctx.store.add(type, {
        parent: target.parent,
        index: target.index,
      });
    } else {
      onInsert?.(target);
    }
  };

  const allowedTypes = target ? [...target.allowedTypes] : [];

  const element = useRender<'button', InsertButtonState>({
    defaultTagName: 'button',
    render,
    props: {
      type: 'button',
      disabled,
      onClick: handleClick,
      ...rest,
      style: {
        position: 'absolute',
        left: target ? target.rect.x + target.rect.width / 2 : 0,
        top: target ? target.rect.y + target.rect.height / 2 : 0,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'auto',
        ...style,
      },
      children,
    },
    state: {
      editorInsertButton: true,
      orientation: target?.orientation ?? 'horizontal',
      emptyContainer: target?.variant === 'box',
      allowedChildTypes: allowedTypes,
    },
  });
  if (!active) return null;
  return element;
}

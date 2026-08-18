import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { EditorStoreState } from '../store';
import type { InsertTarget } from './insert';
import type { InsertOrientation, InsertVariant } from './insert';

import { useRender } from '../../use-render';
import { useEditorSelector } from '../binding';
import { useEditorContext } from '../context';
import { placementOf } from '../hooks';
import { canPlace } from '../schema';
import { blockElements, isInsideReadonly } from './anchors';
import { useCanvasContext } from './context';
import {
  adjustMoveIndex,
  autoScrollAtClient,
  findScrollParent,
  type DragSession,
} from './dnd';
import {
  contentPointFromClient,
  createInsertAdapters,
  resolveDropTarget,
} from './insert-dom';
import { useBlockRect } from './rects';

const subscribeNoop = () => () => {};

function focusBlock(host: HTMLElement, id: string): void {
  const el = blockElements(host, id)[0];
  if (el instanceof HTMLElement) {
    el.focus({ preventScroll: true });
  }
}

function isPrimaryPointer(event: React.PointerEvent | PointerEvent): boolean {
  if (event.pointerType === 'touch' || event.pointerType === 'pen') return true;
  return event.button === 0;
}

function computePaletteInsertTarget(
  state: EditorStoreState,
  userId: string,
  type: string,
  placement: ReturnType<typeof placementOf>,
): {
  parentId: string;
  parentType: string | null;
  index: number | undefined;
} {
  const selectedId = state.selection[userId]?.selected ?? null;
  const selected = selectedId === null ? null : state.nodes[selectedId];
  if (selected && canPlace(placement, type, selected.type)) {
    return {
      parentId: selected.id,
      parentType: selected.type,
      index: undefined,
    };
  }
  if (selected && selected.parentId !== null) {
    const parent = state.nodes[selected.parentId];
    const at = parent ? parent.childIds.indexOf(selected.id) + 1 : undefined;
    return {
      parentId: selected.parentId,
      parentType: parent?.type ?? null,
      index: at,
    };
  }
  return { parentId: state.rootId, parentType: 'root', index: undefined };
}

function useDropTargetSnapshot(): InsertTarget | null {
  const canvas = useCanvasContext('useDropTargetSnapshot');
  const dnd = canvas.dnd;
  return React.useSyncExternalStore(
    dnd ? dnd.subscribeTarget : subscribeNoop,
    () => (dnd ? dnd.getDropTarget() : null),
    () => null,
  );
}

function useDragSessionSnapshot(): DragSession | null {
  const canvas = useCanvasContext('useDragSessionSnapshot');
  const dnd = canvas.dnd;
  return React.useSyncExternalStore(
    dnd ? dnd.subscribeSession : subscribeNoop,
    () => (dnd ? dnd.getSession() : null),
    () => null,
  );
}

export function useDndDropResolution(): void {
  const canvas = useCanvasContext('useDndDropResolution');
  const ctx = useEditorContext('useDndDropResolution');
  const rootId = useEditorSelector((s) => s.rootId);
  const nodes = useEditorSelector((s) => s.nodes);
  const dragging = canvas.dragging;
  const { dnd, host, measurer, interactive } = canvas;
  const placement = placementOf(ctx.schema);
  const nodesRef = React.useRef(nodes);
  nodesRef.current = nodes;

  React.useEffect(() => {
    if (!dragging || !dnd || !host || !measurer || interactive !== 'edit') {
      return;
    }
    let raf = 0;
    const tick = () => {
      const session = dnd.getSession();
      const client = dnd.getClientPoint();
      if (session && client) {
        const scroller = findScrollParent(host) ?? host;
        const scrolled = autoScrollAtClient(scroller, client);
        if (scrolled) {
          const adapters = createInsertAdapters(
            host,
            measurer,
            nodesRef.current,
            rootId,
          );
          const point = contentPointFromClient(host, client);
          canvas.pointer?.setFromEvent(
            {
              clientX: client.x,
              clientY: client.y,
            } as PointerEvent,
            host,
          );
          dnd.setDropTarget(
            resolveDropTarget(
              nodesRef.current,
              placement,
              rootId,
              session,
              point.x,
              point.y,
              adapters,
            ),
          );
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [
    dragging,
    dnd,
    host,
    measurer,
    interactive,
    rootId,
    placement,
    canvas.pointer,
  ]);
}

type GestureOptions = {
  session: DragSession;
  blockId?: string;
  onGestureEnd?: (dragged: boolean) => void;
};

function usePointerGesture({ session, blockId, onGestureEnd }: GestureOptions) {
  const canvas = useCanvasContext('usePointerGesture');
  const ctx = useEditorContext('usePointerGesture');
  const rootId = useEditorSelector((s) => s.rootId);
  const nodes = useEditorSelector((s) => s.nodes);
  const { dnd, host, measurer, pointer, interactive, editing } = canvas;
  const placement = placementOf(ctx.schema);
  const capturedRef = React.useRef(false);
  const nodesRef = React.useRef(nodes);
  nodesRef.current = nodes;

  const resolveTarget = React.useCallback(
    (client: { x: number; y: number }) => {
      if (!dnd || !host || !measurer || interactive !== 'edit') {
        dnd?.setDropTarget(null);
        return;
      }
      const adapters = createInsertAdapters(
        host,
        measurer,
        nodesRef.current,
        rootId,
      );
      const point = contentPointFromClient(host, client);
      pointer?.setFromEvent(
        { clientX: client.x, clientY: client.y } as PointerEvent,
        host,
      );
      dnd.setDropTarget(
        resolveDropTarget(
          nodesRef.current,
          placement,
          rootId,
          session,
          point.x,
          point.y,
          adapters,
        ),
      );
    },
    [dnd, host, measurer, interactive, rootId, placement, pointer, session],
  );

  const commitDrop = React.useCallback(() => {
    if (!dnd || !host) return;
    const target = dnd.getDropTarget();
    const active = dnd.getSession();
    if (!active || !target) {
      dnd.end();
      return;
    }
    if (active.kind === 'new') {
      const id = ctx.store.add(active.type, {
        parentId: target.parentId,
        index: target.index,
        properties: active.properties,
      });
      if (id) {
        ctx.store.select(id);
        focusBlock(host, id);
      }
    } else {
      const fromParent = nodesRef.current[active.id]?.parentId;
      const fromIndex = fromParent
        ? (nodesRef.current[fromParent]?.childIds.indexOf(active.id) ?? -1)
        : -1;
      const adjusted = adjustMoveIndex(
        nodesRef.current,
        active.id,
        target.parentId,
        target.index,
      );
      if (fromParent === target.parentId && fromIndex === adjusted) {
        // same slot
      } else {
        ctx.store.move(active.id, target.parentId, adjusted);
        ctx.store.select(active.id);
        focusBlock(host, active.id);
      }
    }
    dnd.end();
  }, [ctx.store, dnd, host]);

  const canStart = React.useCallback(
    (event: React.PointerEvent, handle: HTMLElement) => {
      if (interactive !== 'edit' || editing) return false;
      if (!isPrimaryPointer(event)) return false;
      if (!host) return false;
      if (isInsideReadonly(handle, host)) return false;
      if (session.kind === 'move') {
        if (!blockId || blockId === rootId || !nodesRef.current[blockId]) {
          return false;
        }
      }
      return true;
    },
    [interactive, editing, host, session.kind, blockId, rootId],
  );

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const handle = event.currentTarget;
      if (!dnd || !canStart(event, handle)) return;
      event.preventDefault();
      // Document listeners: the handle is a small overlay control and may
      // unmount mid-drag; the session must still end on pointerup.
      const doc = handle.ownerDocument;
      const view = doc.defaultView;
      const pointerId = event.pointerId;
      capturedRef.current = false;
      try {
        handle.setPointerCapture(pointerId);
        capturedRef.current = true;
      } catch {
        // capture is optional; document listeners still end the gesture
      }
      dnd.beginGesture({ x: event.clientX, y: event.clientY });

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        if (!dnd.getClientPoint() && !dnd.getSession()) return;
        dnd.moveGesture(
          { x: moveEvent.clientX, y: moveEvent.clientY },
          session,
        );
        if (dnd.getSession()) {
          resolveTarget({
            x: moveEvent.clientX,
            y: moveEvent.clientY,
          });
        }
      };

      const release = () => {
        doc.removeEventListener('pointermove', onMove, true);
        doc.removeEventListener('pointerup', onUp, true);
        doc.removeEventListener('pointercancel', onCancel, true);
        view?.removeEventListener('blur', onBlur);
        if (capturedRef.current) {
          try {
            handle.releasePointerCapture(pointerId);
          } catch {
            // already released
          }
        }
        capturedRef.current = false;
      };

      const onUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) return;
        const dragged = dnd.getSession() !== null;
        if (dragged) {
          commitDrop();
        } else {
          dnd.end();
        }
        onGestureEnd?.(dragged);
        release();
      };

      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) return;
        const dragged = dnd.getSession() !== null;
        dnd.end();
        onGestureEnd?.(dragged);
        release();
      };

      const onBlur = () => {
        const dragged = dnd.getSession() !== null;
        dnd.end();
        onGestureEnd?.(dragged);
        release();
      };

      doc.addEventListener('pointermove', onMove, true);
      doc.addEventListener('pointerup', onUp, true);
      doc.addEventListener('pointercancel', onCancel, true);
      view?.addEventListener('blur', onBlur);
    },
    [canStart, commitDrop, dnd, onGestureEnd, resolveTarget, session],
  );

  return onPointerDown;
}

type DragHandleState = {
  editorDragHandle: boolean;
  dragging: boolean;
};

export type CanvasDragHandleProps = React.ComponentPropsWithRef<'button'> & {
  blockId: string;
  render?: UseRenderComponentProps<'button', DragHandleState>['render'];
};

export function CanvasDragHandle({
  blockId,
  render,
  style,
  onPointerDown,
  ...rest
}: CanvasDragHandleProps) {
  const canvas = useCanvasContext('Canvas.DragHandle');
  const session = useDragSessionSnapshot();
  const gestureDown = usePointerGesture({
    session: { kind: 'move', id: blockId },
    blockId,
  });
  const isDragging =
    session?.kind === 'move' && session.id === blockId && canvas.dragging;

  if (!canvas.host) return null;

  return useRender<'button', DragHandleState>({
    defaultTagName: 'button',
    render,
    props: {
      type: 'button',
      'aria-label': rest['aria-label'] ?? 'Drag to move',
      ...rest,
      style: { touchAction: 'none', ...style },
      onPointerDown: (event) => {
        onPointerDown?.(event);
        gestureDown(event);
      },
    },
    state: {
      editorDragHandle: true,
      dragging: isDragging,
    },
  });
}

type PaletteItemState = {
  editorPaletteItem: boolean;
  blockType: string;
  dragging: boolean;
};

export type CanvasPaletteItemProps = Omit<
  React.ComponentPropsWithRef<'button'>,
  'type'
> & {
  type: string;
  properties?: Record<string, unknown>;
  render?: UseRenderComponentProps<'button', PaletteItemState>['render'];
};

export function CanvasPaletteItem({
  type,
  properties,
  render,
  style,
  onClick,
  onPointerDown,
  ...rest
}: CanvasPaletteItemProps) {
  const canvas = useCanvasContext('Canvas.PaletteItem');
  const ctx = useEditorContext('Canvas.PaletteItem');
  const placement = placementOf(ctx.schema);
  const target = useEditorSelector((state) =>
    computePaletteInsertTarget(state, ctx.userId, type, placement),
  );
  const clickInsertBlocked =
    target.parentType === null || !canPlace(placement, type, target.parentType);
  const skipClickRef = React.useRef(false);
  const onGestureEnd = React.useCallback((dragged: boolean) => {
    skipClickRef.current = dragged;
  }, []);
  const session = useDragSessionSnapshot();
  const gestureDown = usePointerGesture({
    session: { kind: 'new', type, properties },
    onGestureEnd,
  });
  const isDragging =
    session?.kind === 'new' && session.type === type && canvas.dragging;

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || clickInsertBlocked) return;
    // pointerup already committed or cancelled a drag; the compatibility
    // click must not insert a second block.
    if (skipClickRef.current) {
      skipClickRef.current = false;
      return;
    }
    if (canvas.dnd?.getSession()) return;
    const id = ctx.store.add(type, {
      parentId: target.parentId,
      index: target.index,
      properties,
    });
    if (id && canvas.host) {
      focusBlock(canvas.host, id);
    }
  };

  if (!canvas.host) return null;

  return useRender<'button', PaletteItemState>({
    defaultTagName: 'button',
    render,
    props: {
      type: 'button',
      onClick: handleClick,
      ...rest,
      style: { touchAction: 'none', ...style },
      onPointerDown: (event) => {
        onPointerDown?.(event);
        skipClickRef.current = false;
        gestureDown(event);
      },
    },
    state: {
      editorPaletteItem: true,
      blockType: type,
      dragging: isDragging,
    },
  });
}

type DropIndicatorState = {
  editorDropIndicator: boolean;
  orientation: InsertOrientation;
  variant: InsertVariant;
  kind: 'new' | 'move';
};

export type CanvasDropIndicatorProps = React.ComponentPropsWithRef<'div'> & {
  render?: UseRenderComponentProps<'div', DropIndicatorState>['render'];
};

export function CanvasDropIndicator({
  render,
  style,
  ...rest
}: CanvasDropIndicatorProps) {
  useCanvasContext('Canvas.DropIndicator');
  const session = useDragSessionSnapshot();
  const target = useDropTargetSnapshot();

  if (session === null || target === null) return null;

  return useRender<'div', DropIndicatorState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      'aria-hidden': true,
      style: {
        position: 'absolute',
        left: target.rect.x,
        top: target.rect.y,
        width: target.rect.width,
        height: target.rect.height,
        boxSizing: 'border-box',
        pointerEvents: 'none',
        ...style,
      },
    },
    state: {
      editorDropIndicator: true,
      orientation: target.orientation,
      variant: target.variant,
      kind: session.kind,
    },
  });
}

type DragPreviewState = {
  editorDragPreview: boolean;
  kind: 'new' | 'move';
};

export type CanvasDragPreviewProps = React.ComponentPropsWithRef<'div'> & {
  render?: UseRenderComponentProps<'div', DragPreviewState>['render'];
};

export function CanvasDragPreview({
  render,
  style,
  children,
  ...rest
}: CanvasDragPreviewProps) {
  const canvas = useCanvasContext('Canvas.DragPreview');
  const session = useDragSessionSnapshot();
  const moveRect = useBlockRect(session?.kind === 'move' ? session.id : '');
  const pointerSnap = React.useSyncExternalStore(
    canvas.pointer ? canvas.pointer.subscribe : subscribeNoop,
    () => (canvas.pointer ? canvas.pointer.getSnapshot() : null),
    () => null,
  );

  if (session === null || pointerSnap === null) return null;

  const width = session.kind === 'move' && moveRect ? moveRect.width : 80;
  const height = session.kind === 'move' && moveRect ? moveRect.height : 40;

  return useRender<'div', DragPreviewState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      'aria-hidden': true,
      style: {
        position: 'absolute',
        left: pointerSnap.x,
        top: pointerSnap.y,
        width,
        height,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        ...style,
      },
      children,
    },
    state: {
      editorDragPreview: true,
      kind: session.kind,
    },
  });
}

export function CanvasDndEffects() {
  useDndDropResolution();
  return null;
}

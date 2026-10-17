import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { InsertTarget, InsertOrientation, InsertVariant } from './insert';

import { composeRefs, useRender } from '../../use-render';
import { useDocSelector, useSessionSelector } from '../binding';
import { useEditorContext } from '../context';
import { isHTMLElement } from '../dom';
import { insertPointFor } from '../structure/insert-point';
import { blockElements, isInsideReadonly } from './anchors';
import { CanvasContext, useCanvasContext } from './context';
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
import { useCanvasSession, type CanvasSurfaceHandle } from './provider';
import { OVERLAY_CHROME_INSET_PX, visibleIntersection } from './rect';
import { useHostViewBox } from './rects';
import { BlockToolbarContext } from './toolbar';

const subscribeNoop = () => () => {};

function focusBlock(host: HTMLElement, id: string): void {
  const el = blockElements(host, id)[0];
  if (isHTMLElement(el)) {
    el.focus({ preventScroll: true });
  }
}

function focusBlockInSurfaces(
  surfaces: ReadonlyArray<CanvasSurfaceHandle>,
  id: string,
): void {
  for (const surface of surfaces) {
    if (blockElements(surface.host, id).length > 0) {
      focusBlock(surface.host, id);
      return;
    }
  }
}

function containsClientPoint(
  el: HTMLElement,
  client: { x: number; y: number },
): boolean {
  const rect = el.getBoundingClientRect();
  return (
    client.x >= rect.left &&
    client.x <= rect.right &&
    client.y >= rect.top &&
    client.y <= rect.bottom
  );
}

/** Editable surface under the pointer; the last registered match wins. */
function surfaceAtClient(
  surfaces: ReadonlyArray<CanvasSurfaceHandle>,
  client: { x: number; y: number },
): CanvasSurfaceHandle | null {
  for (let i = surfaces.length - 1; i >= 0; i--) {
    const surface = surfaces[i]!;
    if (surface.interactive !== 'edit') continue;
    if (containsClientPoint(surface.host, client)) return surface;
  }
  return null;
}

function isPrimaryPointer(event: React.PointerEvent | PointerEvent): boolean {
  if (event.pointerType === 'touch' || event.pointerType === 'pen') return true;
  return event.button === 0;
}

function useDropTargetSnapshot(): InsertTarget | null {
  const { dnd } = useCanvasSession('useDropTargetSnapshot');
  return React.useSyncExternalStore(
    dnd.subscribeTarget,
    () => dnd.getDropTarget(),
    () => null,
  );
}

function useDragSessionSnapshot(): DragSession | null {
  const { dnd } = useCanvasSession('useDragSessionSnapshot');
  return React.useSyncExternalStore(
    dnd.subscribeSession,
    () => dnd.getSession(),
    () => null,
  );
}

export function useDndDropResolution(): void {
  const canvas = useCanvasContext('useDndDropResolution');
  const ctx = useEditorContext('useDndDropResolution');
  const rootId = useDocSelector((s) => s.rootId);
  const dragging = canvas.dragging;
  const { dnd, host, measurer, interactive } = canvas;
  const store = ctx.store;

  // A remote change can remove the block being dragged: end the drag.
  React.useEffect(() => {
    if (!dnd) return;
    return store.subscribeDoc(() => {
      const session = dnd.getSession();
      if (session?.kind === 'move' && !(session.id in store.getDoc().nodes)) {
        dnd.end();
      }
    });
  }, [dnd, store]);

  React.useEffect(() => {
    if (!dragging || !dnd || !host || !measurer || interactive !== 'edit') {
      return;
    }
    let raf = 0;
    const tick = () => {
      const session = dnd.getSession();
      const client = dnd.getClientPoint();
      // Several Roots can share one session; only the hovered canvas may
      // auto-scroll.
      if (session && client && containsClientPoint(host, client)) {
        const scroller = findScrollParent(host) ?? host;
        const scrolled = autoScrollAtClient(scroller, client);
        if (scrolled) {
          const nodes = store.getDoc().nodes;
          const adapters = createInsertAdapters(host, measurer, nodes, rootId);
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
              ctx.schema,
              nodes,
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
    ctx.schema,
    canvas.pointer,
    store,
  ]);
}

type GestureOptions = {
  session: DragSession;
  blockId?: string;
  onGestureEnd?: (dragged: boolean) => void;
};

function usePointerGesture({ session, blockId, onGestureEnd }: GestureOptions) {
  const canvasSession = useCanvasSession('usePointerGesture');
  const ctx = useEditorContext('usePointerGesture');
  const { dnd, pointer } = canvasSession;
  const capturedRef = React.useRef(false);
  // Surface that produced the current drop target; the drop commits and
  // focuses against that surface's host.
  const lastSurfaceRef = React.useRef<CanvasSurfaceHandle | null>(null);

  const resolveTarget = React.useCallback(
    (client: { x: number; y: number }) => {
      const surface = surfaceAtClient(canvasSession.getSurfaces(), client);
      if (surface === null) {
        dnd.setDropTarget(null);
        return;
      }
      const { host, measurer } = surface;
      // Read at event time: the gesture never subscribes to the node table.
      const { nodes, rootId } = ctx.store.getDoc();
      const adapters = createInsertAdapters(host, measurer, nodes, rootId);
      const point = contentPointFromClient(host, client);
      pointer.setFromEvent(
        { clientX: client.x, clientY: client.y } as PointerEvent,
        host,
      );
      dnd.setDropTarget(
        resolveDropTarget(
          ctx.schema,
          nodes,
          rootId,
          session,
          point.x,
          point.y,
          adapters,
        ),
      );
      lastSurfaceRef.current = surface;
    },
    [canvasSession, ctx.schema, ctx.store, dnd, pointer, session],
  );

  const commitDrop = React.useCallback(() => {
    const target = dnd.getDropTarget();
    const active = dnd.getSession();
    if (!active || !target) {
      dnd.end();
      return;
    }
    const dropHost = lastSurfaceRef.current?.host ?? null;
    if (active.kind === 'new') {
      const id = ctx.store.add(active.type, {
        parent: target.parent,
        index: target.index,
        props: active.properties,
      });
      if (id) {
        ctx.store.select(id);
        if (dropHost) focusBlock(dropHost, id);
      }
    } else {
      const nodes = ctx.store.getDoc().nodes;
      const from = nodes[active.id]?.parent ?? null;
      const fromIndex = from
        ? (nodes[from.id]?.slots[from.slot]?.indexOf(active.id) ?? -1)
        : -1;
      const adjusted = adjustMoveIndex(
        nodes,
        active.id,
        target.parent,
        target.index,
      );
      const samePlace =
        from !== null &&
        from.id === target.parent.id &&
        from.slot === target.parent.slot &&
        fromIndex === adjusted;
      if (!samePlace) {
        ctx.store.move(active.id, { parent: target.parent, index: adjusted });
        ctx.store.select(active.id);
        if (dropHost) focusBlock(dropHost, active.id);
      }
    }
    dnd.end();
  }, [ctx.store, dnd]);

  const canStart = React.useCallback(
    (event: React.PointerEvent, handle: HTMLElement) => {
      if (!isPrimaryPointer(event)) return false;
      const surfaces = canvasSession.getSurfaces();
      const containing =
        surfaces.find((surface) => surface.host.contains(handle)) ?? null;
      if (containing !== null) {
        // Inline editing must not swallow the handle: live QA dragged block
        // edges/text and got native selection because the handle never started.
        if (containing.interactive !== 'edit') {
          return false;
        }
        if (isInsideReadonly(handle, containing.host)) return false;
      } else if (!surfaces.some((surface) => surface.interactive === 'edit')) {
        // A handle in outside chrome needs at least one editable surface to
        // drop into.
        return false;
      }
      if (session.kind === 'move') {
        const { nodes, rootId } = ctx.store.getDoc();
        if (!blockId || blockId === rootId || !nodes[blockId]) {
          return false;
        }
      }
      return true;
    },
    [canvasSession, ctx.store, session.kind, blockId],
  );

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const handle = event.currentTarget;
      if (!canStart(event, handle)) return;
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
      ctx.store.setEditing(null);
      dnd.beginGesture({ x: event.clientX, y: event.clientY });
      lastSurfaceRef.current = null;

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        if (!dnd.getClientPoint() && !dnd.getSession()) return;
        const client = { x: moveEvent.clientX, y: moveEvent.clientY };
        dnd.moveGesture(client, session);
        const surfaces = canvasSession.getSurfaces();
        const surface =
          surfaceAtClient(surfaces, client) ??
          lastSurfaceRef.current ??
          surfaces.find((entry) => entry.interactive === 'edit') ??
          null;
        // Keep the preview hot path alive off-canvas; resolveTarget only
        // writes the pointer when a surface is under the cursor.
        if (surface) {
          pointer.setFromEvent(
            { clientX: client.x, clientY: client.y } as PointerEvent,
            surface.host,
          );
        }
        if (dnd.getSession()) {
          resolveTarget(client);
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
    [
      canStart,
      canvasSession,
      commitDrop,
      ctx.store,
      dnd,
      onGestureEnd,
      pointer,
      resolveTarget,
      session,
    ],
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
  useCanvasSession('Canvas.DragHandle');
  const inToolbar = React.useContext(BlockToolbarContext);
  const canvas = React.useContext(CanvasContext);
  const measurer = canvas?.measurer ?? null;
  const host = canvas?.host ?? null;
  const view = useHostViewBox(host);
  const rect = React.useSyncExternalStore(
    measurer ? measurer.subscribe : subscribeNoop,
    () => (measurer ? measurer.getBlockRect(blockId) : null),
    () => null,
  );
  const session = useDragSessionSnapshot();
  const gestureDown = usePointerGesture({
    session: { kind: 'move', id: blockId },
    blockId,
  });
  const isDragging = session?.kind === 'move' && session.id === blockId;
  const vis = rect ? (visibleIntersection(rect, view) ?? rect) : null;
  const anchorStyle: React.CSSProperties =
    inToolbar || vis === null
      ? {}
      : {
          position: 'absolute',
          left: vis.x + OVERLAY_CHROME_INSET_PX,
          top: vis.y + OVERLAY_CHROME_INSET_PX,
          pointerEvents: 'auto',
          zIndex: 2,
        };

  return useRender<'button', DragHandleState>({
    defaultTagName: 'button',
    render,
    props: {
      type: 'button',
      'aria-label': rest['aria-label'] ?? 'Drag to move',
      ...rest,
      style: {
        touchAction: 'none',
        userSelect: 'none',
        ...anchorStyle,
        ...style,
      },
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
  const canvasSession = useCanvasSession('Canvas.PaletteItem');
  const ctx = useEditorContext('Canvas.PaletteItem');
  const selected = useSessionSelector((s) => s.selection[0] ?? null);
  const target = useDocSelector(
    (state) =>
      insertPointFor(ctx.schema, state.nodes, state.rootId, selected, type),
    (a, b) =>
      a.parent.id === b.parent.id &&
      a.parent.slot === b.parent.slot &&
      a.index === b.index &&
      a.allowed === b.allowed,
  );
  const clickInsertBlocked = !target.allowed;
  const skipClickRef = React.useRef(false);
  const onGestureEnd = React.useCallback((dragged: boolean) => {
    skipClickRef.current = dragged;
  }, []);
  const session = useDragSessionSnapshot();
  const gestureDown = usePointerGesture({
    session: { kind: 'new', type, properties },
    onGestureEnd,
  });
  const isDragging = session?.kind === 'new' && session.type === type;

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || clickInsertBlocked) return;
    // pointerup already committed or cancelled a drag; the compatibility
    // click must not insert a second block.
    if (skipClickRef.current) {
      skipClickRef.current = false;
      return;
    }
    if (canvasSession.dnd.getSession()) return;
    const id = ctx.store.add(type, {
      parent: target.parent,
      index: target.index,
      props: properties,
    });
    if (id) {
      focusBlockInSurfaces(canvasSession.getSurfaces(), id);
    }
  };

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

  const element = useRender<'div', DropIndicatorState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      'aria-hidden': true,
      style: {
        position: 'absolute',
        left: target?.rect.x,
        top: target?.rect.y,
        width: target?.rect.width,
        height: target?.rect.height,
        boxSizing: 'border-box',
        pointerEvents: 'none',
        ...style,
      },
    },
    state: {
      editorDropIndicator: true,
      orientation: target?.orientation ?? 'horizontal',
      variant: target?.variant ?? 'line',
      kind: session?.kind ?? 'new',
    },
  });
  if (session === null || target === null) return null;
  return element;
}

type DragPreviewState = {
  editorDragPreview: boolean;
  kind: 'new' | 'move';
};

export type CanvasDragPreviewProps = React.ComponentPropsWithRef<'div'> & {
  render?: UseRenderComponentProps<'div', DragPreviewState>['render'];
};

function applyPreviewTransform(
  node: HTMLElement,
  snap: { x: number; y: number } | null,
): void {
  if (snap === null) {
    node.style.visibility = 'hidden';
    return;
  }
  node.style.visibility = '';
  node.style.transform = `translate3d(${snap.x}px, ${snap.y}px, 0) translate(-50%, -50%)`;
}

function previewSnap(
  pointer: { getSnapshot: () => { x: number; y: number } | null },
  dnd: { getClientPoint: () => { x: number; y: number } | null },
  host: HTMLElement | null,
): { x: number; y: number } | null {
  const snap = pointer.getSnapshot();
  if (snap) return snap;
  const client = dnd.getClientPoint();
  if (!client || !host) return null;
  const box = host.getBoundingClientRect();
  return {
    x: Math.round(client.x - box.left + host.scrollLeft),
    y: Math.round(client.y - box.top + host.scrollTop),
  };
}

export function CanvasDragPreview({
  render,
  style,
  children,
  ...rest
}: CanvasDragPreviewProps) {
  const { pointer, dnd } = useCanvasSession('Canvas.DragPreview');
  const canvas = React.useContext(CanvasContext);
  const session = useDragSessionSnapshot();
  const measurer = canvas?.measurer ?? null;
  const host = canvas?.host ?? null;
  const moveId = session?.kind === 'move' ? session.id : '';
  const moveRect = React.useSyncExternalStore(
    measurer ? measurer.subscribe : subscribeNoop,
    () => (measurer ? measurer.getBlockRect(moveId) : null),
    () => null,
  );
  const nodeRef = React.useRef<HTMLDivElement | null>(null);

  // Position is written on the DOM node (rAF + translate3d). Subscribing
  // through React would re-render the tree on every pointermove.
  React.useLayoutEffect(() => {
    if (canvas === null || session === null) return;
    const node = nodeRef.current;
    if (!isHTMLElement(node)) return;
    node.style.willChange = 'transform';
    applyPreviewTransform(node, previewSnap(pointer, dnd, host));
    let raf = 0;
    const onPointer = () => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const current = nodeRef.current;
        if (isHTMLElement(current)) {
          applyPreviewTransform(current, previewSnap(pointer, dnd, host));
        }
      });
    };
    const unsubscribe = pointer.subscribe(onPointer);
    return () => {
      unsubscribe();
      if (raf !== 0) cancelAnimationFrame(raf);
      node.style.willChange = '';
    };
  }, [canvas, dnd, host, pointer, session]);

  const width = session?.kind === 'move' && moveRect ? moveRect.width : 80;
  const height = session?.kind === 'move' && moveRect ? moveRect.height : 40;

  const element = useRender<'div', DragPreviewState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      ref: composeRefs(nodeRef, rest.ref),
      'aria-hidden': true,
      style: {
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        pointerEvents: 'none',
        ...style,
      },
      children,
    },
    state: {
      editorDragPreview: true,
      kind: session?.kind ?? 'new',
    },
  });
  // Pointer snapshots are host-relative absolute coordinates, so the
  // preview positions itself only inside a Canvas.Root surface.
  if (canvas === null || session === null) return null;
  return element;
}

export function CanvasDndEffects() {
  useDndDropResolution();
  return null;
}

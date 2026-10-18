import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { InsertTarget, InsertOrientation, InsertVariant } from './insert';
import type { PreviewSurface } from './surface';

import { composeRefs, useRender } from '../../use-render';
import { useDocSelector, useSessionSelector } from '../binding';
import { useEditorContext } from '../context';
import { isHTMLElement, isNode } from '../dom';
import { useMessages } from '../messages';
import { insertPointFor } from '../structure/insert-point';
import { blockElements, isInsideReadonly } from './anchors';
import { CanvasContext, useCanvasContext } from './context';
import {
  createAutoScroller,
  scrollableAncestors,
  type DragSession,
} from './dnd';
import { createDragEngine, draggedIds, type DragEngine } from './drag-engine';
import { activationFor } from './drag-geometry';
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

/** Drag sources own touch input and never select text or show a callout. */
const HANDLE_STYLE = {
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
} as React.CSSProperties;

function focusBlockInSurfaces(
  surfaces: ReadonlyArray<CanvasSurfaceHandle>,
  id: string,
): void {
  for (const surface of surfaces) {
    const el = blockElements(surface.host, id)[0];
    if (isHTMLElement(el)) {
      el.focus({ preventScroll: true });
      return;
    }
  }
}

type Point = { x: number; y: number };

/** The document an event target lives in (the target itself for a document). */
function documentOf(target: EventTarget | null): Document | null {
  if (!isNode(target)) return null;
  return (
    target.ownerDocument ??
    (target.nodeType === 9 ? (target as Document) : null)
  );
}

/** A client point of `doc` in host-page client coordinates. */
function toPage(
  surfaces: ReadonlyArray<CanvasSurfaceHandle>,
  doc: Document,
  client: Point,
): Point {
  for (const entry of surfaces) {
    if (entry.surface.kind !== 'frame' || entry.surface.document !== doc) {
      continue;
    }
    const rect = entry.surface.toHost({ ...client, width: 0, height: 0 });
    return { x: rect.x, y: rect.y };
  }
  return client;
}

function isPrimaryPointer(event: React.PointerEvent | PointerEvent): boolean {
  if (event.pointerType === 'touch' || event.pointerType === 'pen') return true;
  return event.button === 0;
}

/** Controls a drag never starts from: they keep their own pointer behaviour. */
const NO_DRAG =
  'input, textarea, select, a[href], [contenteditable]:not([contenteditable="false"])';

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

/** The drag engine of the enclosing canvas session. */
export function useDragEngine(): DragEngine {
  const canvasSession = useCanvasSession('useDragEngine');
  const ctx = useEditorContext('useDragEngine');
  return React.useMemo(
    () =>
      createDragEngine({
        store: ctx.store,
        schema: ctx.schema,
        dnd: canvasSession.dnd,
        pointer: canvasSession.pointer,
        getSurfaces: canvasSession.getSurfaces,
      }),
    [ctx.store, ctx.schema, canvasSession],
  );
}

export function useDndDropResolution(): void {
  const canvas = useCanvasContext('useDndDropResolution');
  const ctx = useEditorContext('useDndDropResolution');
  const rootId = useDocSelector((s) => s.rootId);
  const dragging = canvas.dragging;
  const { dnd, host, measurer, interactive, surface } = canvas;
  const store = ctx.store;

  // A remote change can remove the block being dragged: end the drag.
  const announcer = ctx.announcer;
  const sourceRemoved = ctx.messages.announce.dragSourceRemoved;
  React.useEffect(() => {
    if (!dnd) return;
    return store.subscribeDoc(() => {
      const session = dnd.getSession();
      if (session?.kind !== 'move') return;
      const nodes = store.getDoc().nodes;
      const gone = (session.ids ?? [session.id]).some((id) => !(id in nodes));
      if (!gone) return;
      dnd.end();
      announcer.announce(sourceRemoved);
    });
  }, [dnd, store, announcer, sourceRemoved]);

  React.useEffect(() => {
    if (!dragging || !dnd || !host || !measurer || interactive !== 'edit') {
      return;
    }
    const view = host.ownerDocument.defaultView;
    if (!view) return;
    const scroller = createAutoScroller();
    let raf = 0;
    const tick = (now: number) => {
      const session = dnd.getSession();
      const page = dnd.getClientPoint();
      const client = page && surface ? surface.fromHost(page) : page;
      // Several Roots can share one session; only the hovered canvas may
      // auto-scroll, innermost scroller first.
      const rect = host.getBoundingClientRect();
      const over =
        client !== null &&
        client.x >= rect.left &&
        client.x <= rect.right &&
        client.y >= rect.top &&
        client.y <= rect.bottom;
      if (session && client && over) {
        const scrolled = scroller.step(scrollableAncestors(host), client, now);
        if (scrolled) {
          // The pointer did not move, the content did: resolve again.
          const nodes = store.getDoc().nodes;
          const adapters = createInsertAdapters(host, measurer, nodes, rootId);
          const point = contentPointFromClient(host, client);
          canvas.pointer?.setFromEvent(
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
        }
      } else {
        scroller.reset();
      }
      raf = view.requestAnimationFrame(tick);
    };
    raf = view.requestAnimationFrame(tick);
    return () => {
      view.cancelAnimationFrame(raf);
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
    surface,
    store,
  ]);
}

type GestureOptions = {
  /** The session a drag of this source starts (read when the drag starts). */
  session: () => DragSession;
  blockId?: string;
  /** A drag handle (a mouse drags on the first movement there). */
  handle?: boolean;
  onGestureEnd?: (dragged: boolean) => void;
};

function usePointerGesture({
  session,
  blockId,
  handle: isHandle = false,
  onGestureEnd,
}: GestureOptions) {
  const canvasSession = useCanvasSession('usePointerGesture');
  const ctx = useEditorContext('usePointerGesture');
  const { dnd } = canvasSession;
  const engine = useDragEngine();
  const capturedRef = React.useRef(false);

  const canStart = React.useCallback(
    (event: React.PointerEvent, handle: HTMLElement) => {
      if (!isPrimaryPointer(event)) return false;
      const target = event.target as Element | null;
      // Inputs, links and editable text keep their own pointer behaviour,
      // and so does every other button inside the source.
      if (target?.closest?.(NO_DRAG)) return false;
      const button = target?.closest?.('button');
      if (button && button !== handle) return false;
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
      if (blockId !== undefined) {
        const { nodes, rootId } = ctx.store.getDoc();
        if (blockId === rootId || !nodes[blockId]) return false;
      }
      return true;
    },
    [canvasSession, ctx.store, blockId],
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
      const activation = activationFor(event.pointerType, isHandle);
      capturedRef.current = false;
      try {
        handle.setPointerCapture(pointerId);
        capturedRef.current = true;
      } catch {
        // capture is optional; document listeners still end the gesture
      }
      ctx.store.setEditing(null);
      const startSurfaces = canvasSession.getSurfaces();
      const origin = toPage(startSurfaces, doc, {
        x: event.clientX,
        y: event.clientY,
      });
      dnd.beginGesture(
        origin,
        activation.kind === 'press' ? Infinity : activation.px,
      );
      // Every same-origin document of the drag reports the pointer: the
      // gesture's own, and the host page when the gesture began in a frame.
      // Frames other than the gesture's stop taking pointer events.
      const docs = new Set<Document>([doc]);
      const shielded: CanvasSurfaceHandle[] = [];
      for (const entry of startSurfaces) {
        if (entry.surface.kind !== 'frame') continue;
        if (entry.surface.document === doc) {
          const hostDoc = entry.surface.window.frameElement?.ownerDocument;
          if (hostDoc) docs.add(hostDoc);
        } else if (entry.shield) {
          entry.shield(true);
          shielded.push(entry);
        }
      }
      const begin = () => {
        if (dnd.getSession()) return;
        engine.start(session());
        handle.setAttribute('data-dragging', '');
      };
      // A touch drag starts after a still press; moving first scrolls.
      let pressTimer: ReturnType<typeof setTimeout> | undefined;
      if (activation.kind === 'press') {
        pressTimer = setTimeout(begin, activation.delayMs);
      }

      const onMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;
        if (!dnd.getClientPoint() && !dnd.getSession()) return;
        const surfaces = canvasSession.getSurfaces();
        const source = documentOf(moveEvent.target) ?? doc;
        const client = toPage(surfaces, source, {
          x: moveEvent.clientX,
          y: moveEvent.clientY,
        });
        if (
          activation.kind === 'press' &&
          !dnd.getSession() &&
          Math.hypot(client.x - origin.x, client.y - origin.y) >
            activation.tolerancePx
        ) {
          dnd.end();
          onGestureEnd?.(false);
          release();
          return;
        }
        if (
          dnd.moveGesture(client, session()) &&
          !handle.hasAttribute('data-dragging')
        ) {
          engine.start(dnd.getSession()!);
          handle.setAttribute('data-dragging', '');
        }
        if (dnd.getSession()) engine.move(client);
      };

      const release = () => {
        clearTimeout(pressTimer);
        handle.removeAttribute('data-dragging');
        for (const target of docs) {
          target.removeEventListener('pointermove', onMove, true);
          target.removeEventListener('pointerup', onUp, true);
          target.removeEventListener('pointercancel', onCancel, true);
        }
        for (const entry of shielded) entry.shield?.(false);
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
        if (dragged) engine.end();
        else dnd.end();
        onGestureEnd?.(dragged);
        release();
      };

      const onCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) return;
        const dragged = dnd.getSession() !== null;
        engine.cancel('pointer-cancel');
        onGestureEnd?.(dragged);
        release();
      };

      const onBlur = () => {
        const dragged = dnd.getSession() !== null;
        engine.cancel('blur');
        onGestureEnd?.(dragged);
        release();
      };

      for (const target of docs) {
        target.addEventListener('pointermove', onMove, true);
        target.addEventListener('pointerup', onUp, true);
        target.addEventListener('pointercancel', onCancel, true);
      }
      view?.addEventListener('blur', onBlur);
    },
    [
      canStart,
      canvasSession,
      ctx.store,
      dnd,
      engine,
      isHandle,
      onGestureEnd,
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
  const messages = useMessages();
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
  const ctx = useEditorContext('Canvas.DragHandle');
  const dragSession = React.useCallback((): DragSession => {
    const ids = draggedIds(ctx.store, blockId);
    return ids.length > 1
      ? { kind: 'move', id: blockId, ids }
      : { kind: 'move', id: blockId };
  }, [ctx.store, blockId]);
  const gestureDown = usePointerGesture({
    session: dragSession,
    blockId,
    handle: true,
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
      'aria-label': rest['aria-label'] ?? messages.parts.dragHandle,
      ...rest,
      style: {
        ...HANDLE_STYLE,
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
  const newSession = React.useCallback(
    (): DragSession => ({ kind: 'new', type, properties }),
    [type, properties],
  );
  const gestureDown = usePointerGesture({
    session: newSession,
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
      style: { ...HANDLE_STYLE, ...style },
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
  surface: PreviewSurface | null,
): { x: number; y: number } | null {
  const snap = pointer.getSnapshot();
  if (snap) return snap;
  const page = dnd.getClientPoint();
  if (!page || !host) return null;
  const client = surface ? surface.fromHost(page) : page;
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
    applyPreviewTransform(
      node,
      previewSnap(pointer, dnd, host, canvas?.surface ?? null),
    );
    let raf = 0;
    const onPointer = () => {
      if (raf !== 0) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const current = nodeRef.current;
        if (isHTMLElement(current)) {
          applyPreviewTransform(
            current,
            previewSnap(pointer, dnd, host, canvas?.surface ?? null),
          );
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

/** Marks the dragged blocks with `data-dragging` while a move runs. */
function useDraggingMarks(): void {
  const canvas = useCanvasContext('CanvasDndEffects');
  const { dnd, host } = canvas;
  React.useEffect(() => {
    if (!dnd || !host) return;
    let marked: Element[] = [];
    const sync = () => {
      for (const el of marked) el.removeAttribute('data-dragging');
      marked = [];
      const session = dnd.getSession();
      if (session?.kind !== 'move') return;
      for (const id of session.ids ?? [session.id]) {
        for (const el of blockElements(host, id)) {
          el.setAttribute('data-dragging', '');
          marked.push(el);
        }
      }
    };
    sync();
    const off = dnd.subscribeSession(sync);
    return () => {
      off();
      for (const el of marked) el.removeAttribute('data-dragging');
    };
  }, [dnd, host]);
}

export function CanvasDndEffects() {
  useDndDropResolution();
  useDraggingMarks();
  return null;
}

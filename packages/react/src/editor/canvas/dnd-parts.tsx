import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { InsertTarget, InsertOrientation, InsertVariant } from './insert';
import type { PreviewSurface } from './surface';

import { composeRefs, useRender } from '../../use-render';
import { describeBlock } from '../announcer';
import { useDocSelector, useSessionSelector } from '../binding';
import { useEditorContext } from '../context';
import { insertionPoints, type InsertionPoint } from '../core/insertion';
import { isHTMLElement, isNode } from '../dom';
import { useBlockActions } from '../hooks';
import { useMessages } from '../messages';
import { useRovingFocus } from '../roving';
import { insertPointFor } from '../structure/insert-point';
import { EditorMoveToDialog } from '../structure/move-to';
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
import { targetFor } from './keyboard-drag';
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

/**
 * Keyboard drag of `blockId` from its handle: Space picks the block up,
 * arrows step through every valid place in document order, Space or
 * Enter drops, Escape (or leaving the handle) puts it back. Each step is
 * announced.
 */
function useKeyboardDrag(
  blockId: string,
  handleRef: React.RefObject<HTMLElement | null>,
) {
  const canvas = React.useContext(CanvasContext);
  const canvasSession = useCanvasSession('Canvas.DragHandle');
  const ctx = useEditorContext('Canvas.DragHandle');
  const engine = useDragEngine();
  const { store, schema, messages, announcer } = ctx;
  const stateRef = React.useRef<{
    points: InsertionPoint[];
    at: number;
    from: InsertionPoint;
    ending: boolean;
  } | null>(null);
  const [active, setActive] = React.useState(false);

  const parentLabel = React.useCallback(
    (parentId: string) => {
      const { nodes, rootId } = store.getDoc();
      const node = nodes[parentId];
      return parentId === rootId || !node
        ? messages.announce.root
        : describeBlock(schema, node).label;
    },
    [store, schema, messages],
  );
  const countIn = React.useCallback(
    (point: InsertionPoint) =>
      (
        store.getDoc().nodes[point.parent.id]?.slots[point.parent.slot] ?? []
      ).filter((id) => id !== blockId).length + 1,
    [store, blockId],
  );

  const show = React.useCallback(
    (point: InsertionPoint) => {
      const measurer = canvas?.measurer;
      const host = canvas?.host;
      if (!measurer || !host) return;
      const { nodes, rootId } = store.getDoc();
      const target = targetFor(point, nodes, rootId, {
        getRect: (id) => measurer.getBlockRect(id),
        getSlotRect: (id, slot) => measurer.getSlotRect(id, slot),
        movingId: blockId,
      });
      const surface =
        canvasSession.getSurfaces().find((entry) => entry.host === host) ??
        undefined;
      engine.setTarget(target, surface);
      const siblings = (
        nodes[point.parent.id]?.slots[point.parent.slot] ?? []
      ).filter((id) => id !== blockId);
      const near = siblings[point.index] ?? siblings[point.index - 1];
      const el = blockElements(host, near ?? point.parent.id)[0];
      el?.scrollIntoView?.({ block: 'nearest' });
    },
    [canvas, canvasSession, engine, store, blockId],
  );

  const finish = React.useCallback(() => {
    stateRef.current = null;
    setActive(false);
    handleRef.current?.focus();
  }, [handleRef]);

  // The drag can end elsewhere (the canvas's Escape, a remote removal).
  React.useEffect(
    () =>
      canvasSession.dnd.subscribeSession(() => {
        const state = stateRef.current;
        if (!state || state.ending || canvasSession.dnd.getSession()) return;
        const node = store.getDoc().nodes[blockId];
        if (node) {
          announcer.announce(
            messages.announce.dragCancelled({
              block: describeBlock(schema, node),
              position: state.from.index + 1,
              count: countIn(state.from),
              parent: parentLabel(state.from.parent.id),
            }),
          );
        }
        finish();
      }),
    [
      canvasSession,
      store,
      blockId,
      announcer,
      messages,
      schema,
      countIn,
      parentLabel,
      finish,
    ],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const state = stateRef.current;
    const { nodes, rootId } = store.getDoc();
    const node = nodes[blockId];
    if (!node || node.parent === null) return;
    const block = describeBlock(schema, node);
    if (!state) {
      if (event.key !== ' ') return;
      event.preventDefault();
      const points = insertionPoints(schema, nodes, rootId, node.type, blockId);
      const index =
        nodes[node.parent.id]?.slots[node.parent.slot]?.indexOf(blockId) ?? 0;
      const at = points.findIndex(
        (point) =>
          point.parent.id === node.parent!.id &&
          point.parent.slot === node.parent!.slot &&
          point.index === index,
      );
      if (points.length < 2 || at < 0) {
        announcer.announce(messages.announce.dragNoTargets);
        return;
      }
      stateRef.current = { points, at, from: points[at]!, ending: false };
      setActive(true);
      engine.start({ kind: 'move', id: blockId });
      show(points[at]!);
      announcer.announce(
        messages.announce.dragPickedUp({
          block,
          position: index + 1,
          count: countIn(points[at]!),
          parent: parentLabel(node.parent.id),
        }),
      );
      return;
    }
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    if (step !== 0) {
      event.preventDefault();
      const at = Math.max(
        0,
        Math.min(state.points.length - 1, state.at + step),
      );
      if (at === state.at) return;
      state.at = at;
      const point = state.points[at]!;
      show(point);
      announcer.announce(
        messages.announce.dragMoved({
          position: point.index + 1,
          count: countIn(point),
          parent: parentLabel(point.parent.id),
        }),
      );
      return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      const point = state.points[state.at]!;
      state.ending = true;
      engine.end();
      announcer.announce(
        messages.announce.dragDropped({
          block,
          position: point.index + 1,
          parent: parentLabel(point.parent.id),
        }),
      );
      finish();
      return;
    }
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      // The subscription above announces the cancel and resets.
      engine.cancel('escape');
    }
  };

  const onBlur = () => {
    if (stateRef.current && !stateRef.current.ending) engine.cancel('blur');
  };

  return { active, onKeyDown, onBlur };
}

/** The handle's menu: the non-drag way to move, copy and delete a block. */
function HandleMenu({
  blockId,
  onClose,
  onMoveTo,
}: {
  blockId: string;
  onClose: (restore: boolean) => void;
  onMoveTo: () => void;
}) {
  const messages = useMessages();
  const actions = useBlockActions(blockId);
  const roving = useRovingFocus<HTMLDivElement>({ orientation: 'vertical' });
  const rovingFocus = roving.focus;
  React.useLayoutEffect(() => {
    rovingFocus();
  }, [rovingFocus]);
  const item = (
    label: string,
    run: () => unknown,
    disabled = false,
    closes = true,
  ) => (
    <button
      type="button"
      role="menuitem"
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (disabled) return;
        if (closes) onClose(true);
        run();
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      ref={roving.ref}
      role="menu"
      aria-label={messages.parts.handleMenu}
      data-editor-handle-menu=""
      style={{ position: 'absolute', pointerEvents: 'auto', zIndex: 3 }}
      onFocus={roving.onFocus}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault();
          onClose(true);
          return;
        }
        roving.onKeyDown(event);
      }}
    >
      {item(
        messages.commands['block.moveUp'] ?? 'block.moveUp',
        actions.moveUp,
        !actions.canMoveUp,
      )}
      {item(
        messages.commands['block.moveDown'] ?? 'block.moveDown',
        actions.moveDown,
        !actions.canMoveDown,
      )}
      {item(messages.parts.moveTo, onMoveTo, false, false)}
      {item(
        messages.commands['block.duplicate'] ?? 'block.duplicate',
        actions.duplicate,
      )}
      {item(
        messages.commands['block.remove'] ?? 'block.remove',
        actions.remove,
      )}
    </div>
  );
}

export function CanvasDragHandle({
  blockId,
  render,
  style,
  onPointerDown,
  onClick,
  onKeyDown,
  onKeyUp,
  onBlur,
  ref,
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
  const handleRef = React.useRef<HTMLButtonElement | null>(null);
  const [menu, setMenu] = React.useState<'closed' | 'menu' | 'move-to'>(
    'closed',
  );
  const skipClickRef = React.useRef(false);
  const keyboard = useKeyboardDrag(blockId, handleRef);
  const dragSession = React.useCallback((): DragSession => {
    const ids = draggedIds(ctx.store, blockId);
    return ids.length > 1
      ? { kind: 'move', id: blockId, ids }
      : { kind: 'move', id: blockId };
  }, [ctx.store, blockId]);
  const onGestureEnd = React.useCallback((dragged: boolean) => {
    skipClickRef.current = dragged;
  }, []);
  const gestureDown = usePointerGesture({
    session: dragSession,
    blockId,
    handle: true,
    onGestureEnd,
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
  const closeMenu = React.useCallback((restore: boolean) => {
    setMenu('closed');
    if (restore) handleRef.current?.focus();
  }, []);

  const button = useRender<'button', DragHandleState>({
    defaultTagName: 'button',
    render,
    props: {
      type: 'button',
      'aria-label': rest['aria-label'] ?? messages.parts.dragHandle,
      'aria-haspopup': 'menu',
      'aria-expanded': menu === 'menu',
      'aria-pressed': keyboard.active || undefined,
      ...rest,
      ref: composeRefs(handleRef, ref),
      style: {
        ...HANDLE_STYLE,
        ...anchorStyle,
        ...style,
      },
      onPointerDown: (event) => {
        onPointerDown?.(event);
        skipClickRef.current = false;
        gestureDown(event);
      },
      onClick: (event) => {
        onClick?.(event);
        // A pointer drag ends with a compatibility click: no menu then.
        if (event.defaultPrevented || skipClickRef.current) {
          skipClickRef.current = false;
          return;
        }
        if (keyboard.active) return;
        setMenu((open) => (open === 'closed' ? 'menu' : 'closed'));
      },
      onKeyDown: (event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        keyboard.onKeyDown(event);
      },
      onKeyUp: (event) => {
        onKeyUp?.(event);
        // Space picked the block up or dropped it; it does not click.
        if (event.key === ' ') event.preventDefault();
      },
      onBlur: (event) => {
        onBlur?.(event);
        keyboard.onBlur();
      },
    },
    state: {
      editorDragHandle: true,
      dragging: isDragging || keyboard.active,
    },
  });

  return (
    <>
      {button}
      {menu === 'menu' ? (
        <HandleMenu
          blockId={blockId}
          onClose={closeMenu}
          onMoveTo={() => setMenu('move-to')}
        />
      ) : null}
      {menu === 'move-to' ? (
        <EditorMoveToDialog
          blockId={blockId}
          onClose={() => closeMenu(true)}
          data-editor-move-to=""
          style={{ position: 'absolute', pointerEvents: 'auto', zIndex: 3 }}
        />
      ) : null}
    </>
  );
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

type DropTargetRingState = {
  editorDropTargetRing: boolean;
  nested: boolean;
};

export type CanvasDropTargetRingProps = React.ComponentPropsWithRef<'div'> & {
  render?: UseRenderComponentProps<'div', DropTargetRingState>['render'];
};

/**
 * Outlines the container a drag would drop into (the target slot's
 * element, else its block), in the overlay; style it with
 * `data-editor-drop-target-ring` (`data-nested` is absent at the root).
 */
export function CanvasDropTargetRing({
  render,
  style,
  ...rest
}: CanvasDropTargetRingProps) {
  const canvas = useCanvasContext('Canvas.DropTargetRing');
  const session = useDragSessionSnapshot();
  const target = useDropTargetSnapshot();
  const measurer = canvas.measurer;
  const rect = React.useSyncExternalStore(
    measurer ? measurer.subscribe : subscribeNoop,
    () =>
      measurer && target
        ? (measurer.getSlotRect(target.parent.id, target.parent.slot) ??
          measurer.getBlockRect(target.parent.id))
        : null,
    () => null,
  );
  const element = useRender<'div', DropTargetRingState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      'aria-hidden': true,
      style: {
        position: 'absolute',
        left: rect?.x,
        top: rect?.y,
        width: rect?.width,
        height: rect?.height,
        boxSizing: 'border-box',
        pointerEvents: 'none',
        ...style,
      },
    },
    state: {
      editorDropTargetRing: true,
      nested: target?.nested ?? false,
    },
  });
  if (session === null || target === null || rect === null) return null;
  return element;
}

type DragPreviewState = {
  editorDragPreview: boolean;
  /** Blocks the drag moves (a multi-selection shows as a stack). */
  count: number;
  kind: 'new' | 'move';
};

export type CanvasDragPreviewProps = React.ComponentPropsWithRef<'div'> & {
  render?: UseRenderComponentProps<'div', DragPreviewState>['render'];
};

const PREVIEW_OFFSET = { x: 16, y: 8 } as const;
/** The preview never grows past this square. */
export const DRAG_PREVIEW_MAX_PX = 280;

function applyPreviewTransform(
  node: HTMLElement,
  snap: { x: number; y: number } | null,
): void {
  if (snap === null) {
    node.style.visibility = 'hidden';
    return;
  }
  node.style.visibility = '';
  // Beside the pointer, never under it: 16 px right, 8 px down.
  node.style.transform = `translate3d(${snap.x + PREVIEW_OFFSET.x}px, ${snap.y + PREVIEW_OFFSET.y}px, 0)`;
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

  const width = Math.min(
    DRAG_PREVIEW_MAX_PX,
    session?.kind === 'move' && moveRect ? moveRect.width : 80,
  );
  const height = Math.min(
    DRAG_PREVIEW_MAX_PX,
    session?.kind === 'move' && moveRect ? moveRect.height : 40,
  );
  const ctx = useEditorContext('Canvas.DragPreview');
  const count = session?.kind === 'move' ? (session.ids?.length ?? 1) : 1;
  const summary = React.useMemo(() => {
    if (!session) return null;
    if (session.kind === 'new') {
      return {
        label: ctx.schema.components[session.type]?.label ?? session.type,
        excerpt: '',
      };
    }
    const node = ctx.store.getDoc().nodes[session.id];
    return node ? describeBlock(ctx.schema, node) : null;
  }, [session, ctx.schema, ctx.store]);

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
        overflow: 'hidden',
        pointerEvents: 'none',
        ...style,
      },
      // At most three things: the label, an excerpt, and the count of a
      // multi-selection.
      children:
        children ??
        (summary ? (
          <>
            <span data-editor-drag-preview-label="">{summary.label}</span>
            {summary.excerpt ? (
              <span data-editor-drag-preview-excerpt="">{summary.excerpt}</span>
            ) : null}
            {count > 1 ? (
              <span data-editor-drag-preview-count="">{count}</span>
            ) : null}
          </>
        ) : null),
    },
    state: {
      editorDragPreview: true,
      count,
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

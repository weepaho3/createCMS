import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { Field, FieldKind } from '../core/schema';
import type {
  CanvasClickToEdit,
  CanvasContextValue,
  InlineCaretPoint,
} from './context';
import type {
  CanvasFrameOptions,
  CanvasFrameWrapper,
} from './frame/frame-shell';
import type { CanvasComponents } from './map';
import type { Measurer } from './measurer';
import type { PreviewSurface } from './surface';

import { composeRefs, useRender } from '../../use-render';
import { useDocSelector, useSessionSelector } from '../binding';
import { useEditorContext } from '../context';
import { warnOnce } from '../core/codes';
import { CanvasContext } from './context';
import { type DndStore } from './dnd';
import { CanvasDndEffects } from './dnd-parts';
import { createEditCache, type EditCache } from './edit';
import { CanvasFrameShell } from './frame/frame-shell';
import { handleCanvasClick, handleCanvasPointerOver } from './interact';
import { createMeasurer } from './measurer';
import { type PointerStore } from './pointer';
import {
  CanvasSessionContext,
  createCanvasSession,
  type CanvasSessionContextValue,
} from './provider';
import {
  type BlockErrorInfo,
  BlockView,
  CanvasRenderContext,
  type CanvasRenderDeps,
  createResolveTick,
  type UnknownBlockInfo,
} from './renderer';
import {
  type CanvasResolve,
  createResolveCache,
  readResolved,
  type ResolveCache,
} from './resolve';
import { createFrameSurface, createInlineSurface } from './surface';

const subscribeNoop = () => () => {};
const HOVER_LEAVE_MS = 100;

export type CanvasInteractive = 'edit' | 'select' | 'none';
export type CanvasSurface = 'inline' | 'frame';

type CanvasRootState = {
  interactive: CanvasInteractive;
  /** Mirrored frame stylesheets are still loading. */
  loading: boolean;
  dragging: boolean;
  editing: boolean;
  editorCanvas: boolean;
};

export type CanvasRootProps = Omit<
  React.ComponentPropsWithRef<'div'>,
  'children'
> & {
  components: CanvasComponents;
  surface?: CanvasSurface;
  interactive?: CanvasInteractive;
  resolve?: CanvasResolve;
  /**
   * Groups the root's blocks into wrappers of this many blocks with
   * `content-visibility: auto` (20 to 50 works well for long documents).
   * Off by default: the wrappers sit between the root and its blocks.
   */
  chunkSize?: number;
  /** Replaces `Canvas.BlockError` for a block that threw while rendering. */
  renderBlockError?: (info: BlockErrorInfo) => React.ReactNode;
  /** Replaces `Canvas.UnknownBlock` for a block type without a component. */
  renderUnknownBlock?: (info: UnknownBlockInfo) => React.ReactNode;
  /**
   * How a click on a text field starts editing. Default: by pointer type,
   * `select-and-edit` for a mouse, `select-first` for touch and pen.
   */
  clickToEdit?: CanvasClickToEdit;
  /** With `surface="frame"`: head, body attributes, width, height, scale, styles. */
  frame?: CanvasFrameOptions;
  /** With `surface="frame"`: wraps the canvas inside the frame (an e-mail table). */
  wrapper?: CanvasFrameWrapper;
  children?: React.ReactNode;
  render?: UseRenderComponentProps<'div', CanvasRootState>['render'];
};

export function CanvasRoot({
  components,
  surface = 'inline',
  interactive = 'edit',
  resolve,
  chunkSize,
  renderBlockError,
  renderUnknownBlock,
  clickToEdit,
  frame,
  wrapper,
  children,
  render,
  style,
  ...rest
}: CanvasRootProps) {
  const framed = surface === 'frame';
  const ctx = useEditorContext('Canvas.Root');
  const rootId = useDocSelector((s) => s.rootId);
  const editing = useSessionSelector((s) => s.editing !== null);

  const componentsRef = React.useRef(components);
  const resolveRef = React.useRef(resolve);
  const interactiveRef = React.useRef(interactive);
  const storeRef = React.useRef(ctx.store);
  const clickToEditRef = React.useRef(clickToEdit);
  const pointerTypeRef = React.useRef('mouse');
  // The primary selection when the pointer went down: a select-first tap
  // edits only a block that was already selected before it.
  const selectedAtDownRef = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    clickToEditRef.current = clickToEdit;
    componentsRef.current = components;
    resolveRef.current = resolve;
    interactiveRef.current = interactive;
    storeRef.current = ctx.store;
  });

  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const tickRef = React.useRef<ReturnType<typeof createResolveTick> | null>(
    null,
  );
  tickRef.current ??= createResolveTick();
  const cacheRef = React.useRef<ResolveCache | null>(null);
  if (cacheRef.current === null) {
    const tick = tickRef.current;
    cacheRef.current = createResolveCache({
      onTick: () => tick.bump(),
      isMounted: () => mountedRef.current,
    });
  }
  const editsRef = React.useRef<EditCache | null>(null);
  if (editsRef.current === null) {
    editsRef.current = createEditCache();
  }

  const hostRef = React.useRef<HTMLDivElement | null>(null);
  // The canvas element; inside a frame it changes when the frame reloads.
  const [hostNode, setHostNode] = React.useState<HTMLDivElement | null>(null);
  const setHost = React.useCallback((node: HTMLDivElement | null) => {
    hostRef.current = node;
    setHostNode(node);
  }, []);
  const [frameEl, setFrameEl] = React.useState<HTMLIFrameElement | null>(null);
  const [hostLayer, setHostLayer] = React.useState<HTMLElement | null>(null);
  const [stylesLoading, setStylesLoading] = React.useState(false);
  const inlineCaretRef = React.useRef<InlineCaretPoint | null>(null);
  const measurerRef = React.useRef<Measurer | null>(null);
  const [hostEl, setHostEl] = React.useState<HTMLElement | null>(null);
  const [measurer, setMeasurer] = React.useState<Measurer | null>(null);
  const [pointer, setPointer] = React.useState<PointerStore | null>(null);
  const [dnd, setDnd] = React.useState<DndStore | null>(null);

  // An outer Canvas.Provider owns the drag session; without one the Root
  // creates it and provides the session context itself, so parts below a
  // bare Root keep finding it.
  const outerSession = React.useContext(CanvasSessionContext);
  const ownSessionRef = React.useRef<CanvasSessionContextValue | null>(null);
  if (outerSession === null && ownSessionRef.current === null) {
    ownSessionRef.current = createCanvasSession();
  }
  const session = outerSession ?? ownSessionRef.current!;
  const sessionRef = React.useRef(session);
  React.useLayoutEffect(() => {
    sessionRef.current = session;
  });

  React.useEffect(
    () => () => {
      // Destroy only what this Root created; a Provider-owned session
      // outlives the Root.
      ownSessionRef.current?.dnd.destroy();
    },
    [],
  );

  React.useLayoutEffect(() => {
    const node = hostNode;
    if (!node) return;
    const next = createMeasurer(node);
    measurerRef.current = next;
    setHostEl(node);
    setMeasurer(next);
    setPointer(sessionRef.current.pointer);
    setDnd(sessionRef.current.dnd);
    return () => {
      next.destroy();
      measurerRef.current = null;
      setHostEl(null);
      setMeasurer(null);
    };
  }, [hostNode]);

  React.useLayoutEffect(() => {
    const host = hostNode;
    const pointerStore = sessionRef.current.pointer;
    if (!host) return;
    const onClick = (event: Event) => {
      handleCanvasClick(event, host, storeRef.current, interactiveRef.current);
    };
    // Hover shows at once and clears after a short delay, so moving
    // between blocks or onto chrome does not flicker.
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;
    const hoverNow = (id: string | null) => {
      clearTimeout(leaveTimer);
      if (id !== null) {
        storeRef.current.hover(id);
        return;
      }
      leaveTimer = setTimeout(
        () => storeRef.current.hover(null),
        HOVER_LEAVE_MS,
      );
    };
    const onPointerOver = (event: Event) => {
      if ((event as PointerEvent).pointerType === 'touch') return;
      const next = handleCanvasPointerOver(event, host, interactiveRef.current);
      if (next !== undefined) hoverNow(next);
    };
    const onPointerDown = (event: Event) => {
      pointerTypeRef.current = (event as PointerEvent).pointerType || 'mouse';
      selectedAtDownRef.current =
        storeRef.current.getSession().selection[0] ?? null;
    };
    const onPointerMove = (event: Event) => {
      pointerStore.setFromEvent(event as PointerEvent, host);
    };
    const onPointerLeave = () => {
      if (sessionRef.current.dnd.getSession()) return;
      pointerStore.clear();
      hoverNow(null);
    };
    host.addEventListener('pointerdown', onPointerDown, true);
    host.addEventListener('click', onClick, true);
    host.addEventListener('pointerover', onPointerOver);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerleave', onPointerLeave);
    return () => {
      clearTimeout(leaveTimer);
      host.removeEventListener('pointerdown', onPointerDown, true);
      host.removeEventListener('click', onClick, true);
      host.removeEventListener('pointerover', onPointerOver);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [hostNode]);

  const dragging = React.useSyncExternalStore(
    dnd ? dnd.subscribeSession : subscribeNoop,
    () => (dnd ? dnd.getSession() !== null : false),
    () => false,
  );

  React.useLayoutEffect(() => {
    const host = hostNode;
    const dndStore = sessionRef.current.dnd;
    if (!host) return;
    const doc = host.ownerDocument;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || dndStore.getSession() === null) return;
      event.preventDefault();
      event.stopPropagation();
      dndStore.end();
    };
    doc.addEventListener('keydown', onKeyDown, true);
    return () => {
      doc.removeEventListener('keydown', onKeyDown, true);
    };
  }, [hostNode]);

  const previewSurface = React.useMemo((): PreviewSurface | null => {
    if (!hostEl) return null;
    if (!framed) return createInlineSurface(hostEl);
    return frameEl ? createFrameSurface(frameEl, hostEl) : null;
  }, [framed, hostEl, frameEl]);

  const surfaceHandleRef = React.useRef<{
    host: HTMLElement;
    measurer: Measurer;
    interactive: CanvasInteractive;
    editing: boolean;
    surface: PreviewSurface;
    shield?: (on: boolean) => void;
  } | null>(null);

  React.useLayoutEffect(() => {
    if (!hostEl || !measurer || !previewSurface) return;
    // The handle object stays identical while registered; `interactive` and
    // `editing` are mutated in place by the sync effect below so gesture
    // handlers read current values without a re-registration (registration
    // order is the paint-order tiebreak and must not change).
    const handle = {
      host: hostEl,
      measurer,
      interactive: interactiveRef.current,
      editing: false,
      surface: previewSurface,
      shield: frameEl
        ? (on: boolean) => {
            frameEl.style.pointerEvents = on ? 'none' : '';
          }
        : undefined,
    };
    surfaceHandleRef.current = handle;
    const unregister = sessionRef.current.registerSurface(handle);
    return () => {
      unregister();
      surfaceHandleRef.current = null;
    };
  }, [hostEl, measurer, previewSurface, frameEl]);

  React.useLayoutEffect(() => {
    const handle = surfaceHandleRef.current;
    if (!handle) return;
    handle.interactive = interactive;
    handle.editing = editing;
  });

  const renderDeps = React.useMemo((): CanvasRenderDeps => {
    const cache = cacheRef.current!;
    const edits = editsRef.current!;
    const tick = tickRef.current!;
    return {
      store: ctx.store,
      schema: ctx.schema,
      components,
      resolve,
      cache,
      edits,
      tick,
      renderBlockError,
      renderUnknownBlock,
      chunkSize,
      deferUpdates: interactive === 'none',
      isDragging: () => sessionRef.current.dnd.getSession() !== null,
      subscribeDragging: (listener) =>
        sessionRef.current.dnd.subscribeSession(listener),
      onBlockRendered(id, type) {
        if (!components[type]) return;
        // Block layout effects run before the host ref attaches: check
        // once the commit finished.
        queueMicrotask(() => {
          const host = hostRef.current;
          if (!host) return;
          const found = host.querySelector(
            `[data-editor-block="${CSS.escape(id)}"]`,
          );
          if (!found && process.env.NODE_ENV !== 'production') {
            warnOnce(
              'E005',
              `Canvas.Root: block "${id}" (type "${type}") rendered no [data-editor-block] attribute. Spread edit.block on the block's root element. A display: contents wrapper is the documented escape when the component has no single root.`,
            );
          }
        });
      },
    };
  }, [
    ctx.store,
    ctx.schema,
    components,
    resolve,
    renderBlockError,
    renderUnknownBlock,
    chunkSize,
    interactive,
  ]);

  const read = React.useMemo(() => {
    const cache = cacheRef.current!;
    return (kind: FieldKind, value: unknown, spec: Field) =>
      readResolved(kind, value, spec, resolveRef.current, cache);
  }, []);

  const clickEdits = React.useCallback((blockId: string): boolean => {
    const mode: CanvasClickToEdit =
      clickToEditRef.current ??
      (pointerTypeRef.current === 'mouse' ? 'select-and-edit' : 'select-first');
    return mode === 'select-and-edit' || selectedAtDownRef.current === blockId;
  }, []);

  const canvasContext = React.useMemo((): CanvasContextValue => {
    return {
      clickEdits,
      read,
      host: hostEl,
      measurer,
      pointer,
      dnd,
      interactive,
      dragging,
      editing,
      inlineCaret: inlineCaretRef,
      surface: previewSurface,
      hostLayer: framed ? hostLayer : null,
    };
  }, [
    read,
    hostEl,
    measurer,
    pointer,
    dnd,
    interactive,
    dragging,
    editing,
    clickEdits,
    previewSurface,
    framed,
    hostLayer,
  ]);

  const { ref: outerRef, ...hostRest } = rest;
  // Inside a frame the outer element in the host page takes the consumer's
  // props; the canvas element only its own.
  const canvasProps: typeof hostRest = framed ? {} : hostRest;
  const host = useRender<'div', CanvasRootState>({
    defaultTagName: 'div',
    render,
    props: {
      ...canvasProps,
      // No double-tap zoom delay on touch.
      style: framed
        ? { touchAction: 'manipulation', position: 'relative' }
        : { touchAction: 'manipulation', ...style },
      ref: framed ? setHost : composeRefs(outerRef, setHost),
      children: (
        <>
          <CanvasRenderContext.Provider value={renderDeps}>
            <BlockView id={rootId} />
          </CanvasRenderContext.Provider>
          <CanvasDndEffects />
          {children}
        </>
      ),
    },
    state: {
      interactive,
      loading: stylesLoading,
      dragging,
      editing,
      editorCanvas: true,
    },
  });

  const content = (
    <CanvasContext.Provider value={canvasContext}>
      {framed ? (
        <CanvasFrameShell
          options={frame ?? {}}
          wrapper={wrapper}
          outer={{ ...hostRest, ref: outerRef, style }}
          hostNode={hostNode}
          onFrame={setFrameEl}
          onHostLayer={setHostLayer}
          onLoading={setStylesLoading}
        >
          {host}
        </CanvasFrameShell>
      ) : (
        host
      )}
    </CanvasContext.Provider>
  );

  if (outerSession !== null) return content;

  return (
    <CanvasSessionContext.Provider value={session}>
      {content}
    </CanvasSessionContext.Provider>
  );
}

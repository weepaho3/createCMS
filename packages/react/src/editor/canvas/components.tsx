import type { BlockProperty } from '@createcms/schema';

import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { CanvasContextValue, InlineCaretPoint } from './context';
import type { CanvasComponents } from './map';
import type { Measurer } from './measurer';

import { composeRefs, useRender } from '../../use-render';
import { useEditorSelector } from '../binding';
import { useEditorContext } from '../context';
import { CanvasContext } from './context';
import { type DndStore } from './dnd';
import { CanvasDndEffects } from './dnd-parts';
import { createEditCache, type EditCache } from './edit';
import { handleCanvasClick, handleCanvasPointerOver } from './interact';
import { resolveComponentMap } from './map';
import { createMeasurer } from './measurer';
import { type PointerStore } from './pointer';
import {
  CanvasSessionContext,
  createCanvasSession,
  type CanvasSessionContextValue,
} from './provider';
import { renderStoreTree } from './renderer';
import {
  type CanvasResolve,
  type ResolveKind,
  createResolveCache,
  readResolved,
  type ResolveCache,
} from './resolve';

const subscribeNoop = () => () => {};

const warned = new Set<string>();

function warnOnce(message: string): void {
  if (process.env.NODE_ENV === 'production') return;
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

export type CanvasInteractive = 'edit' | 'select' | 'none';
export type CanvasSurface = 'inline' | 'frame';

type CanvasRootState = {
  interactive: CanvasInteractive;
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
  children?: React.ReactNode;
  render?: UseRenderComponentProps<'div', CanvasRootState>['render'];
};

export function CanvasRoot({
  components,
  surface = 'inline',
  interactive = 'edit',
  resolve,
  children,
  render,
  ...rest
}: CanvasRootProps) {
  const ctx = useEditorContext('Canvas.Root');
  const version = useEditorSelector((s) => s.version);
  const rootId = useEditorSelector((s) => s.rootId);
  const nodes = useEditorSelector((s) => s.nodes);
  const editing = useEditorSelector((s) => {
    const local = s.selection[ctx.userId];
    return local?.editing != null;
  });

  const componentsRef = React.useRef(components);
  const resolveRef = React.useRef(resolve);
  const interactiveRef = React.useRef(interactive);
  const storeRef = React.useRef(ctx.store);
  React.useLayoutEffect(() => {
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

  const [, setTick] = React.useState(0);
  const cacheRef = React.useRef<ResolveCache | null>(null);
  if (cacheRef.current === null) {
    cacheRef.current = createResolveCache({
      onTick: () => setTick((n) => n + 1),
      isMounted: () => mountedRef.current,
    });
  }
  const editsRef = React.useRef<EditCache | null>(null);
  if (editsRef.current === null) {
    editsRef.current = createEditCache();
  }

  const hostRef = React.useRef<HTMLDivElement | null>(null);
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

  React.useLayoutEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const next = createMeasurer(node);
    measurerRef.current = next;
    setHostEl(node);
    setMeasurer(next);
    setPointer(sessionRef.current.pointer);
    setDnd(sessionRef.current.dnd);
    return () => {
      next.destroy();
      // Destroy only what this Root created; a Provider-owned session
      // outlives the Root.
      ownSessionRef.current?.dnd.destroy();
      measurerRef.current = null;
    };
  }, []);

  React.useLayoutEffect(() => {
    const host = hostRef.current;
    const pointerStore = sessionRef.current.pointer;
    if (!host) return;
    const onClick = (event: Event) => {
      handleCanvasClick(event, host, storeRef.current, interactiveRef.current);
    };
    const onPointerOver = (event: Event) => {
      handleCanvasPointerOver(
        event,
        host,
        storeRef.current,
        interactiveRef.current,
      );
    };
    const onPointerMove = (event: Event) => {
      pointerStore.setFromEvent(event as PointerEvent, host);
    };
    const onPointerLeave = () => {
      if (sessionRef.current.dnd.getSession()) return;
      pointerStore.clear();
      storeRef.current.hover(null);
    };
    host.addEventListener('click', onClick, true);
    host.addEventListener('pointerover', onPointerOver);
    host.addEventListener('pointermove', onPointerMove);
    host.addEventListener('pointerleave', onPointerLeave);
    return () => {
      host.removeEventListener('click', onClick, true);
      host.removeEventListener('pointerover', onPointerOver);
      host.removeEventListener('pointermove', onPointerMove);
      host.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [version]);

  const dragging = React.useSyncExternalStore(
    dnd ? dnd.subscribeSession : subscribeNoop,
    () => (dnd ? dnd.getSession() !== null : false),
    () => false,
  );

  React.useLayoutEffect(() => {
    const host = hostRef.current;
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
  }, [version]);

  const surfaceHandleRef = React.useRef<{
    host: HTMLElement;
    measurer: Measurer;
    interactive: CanvasInteractive;
    editing: boolean;
  } | null>(null);

  React.useLayoutEffect(() => {
    if (!hostEl || !measurer) return;
    // The handle object stays identical while registered; `interactive` and
    // `editing` are mutated in place by the sync effect below so gesture
    // handlers read current values without a re-registration (registration
    // order is the paint-order tiebreak and must not change).
    const handle = {
      host: hostEl,
      measurer,
      interactive: interactiveRef.current,
      editing: false,
    };
    surfaceHandleRef.current = handle;
    const unregister = sessionRef.current.registerSurface(handle);
    return () => {
      unregister();
      surfaceHandleRef.current = null;
    };
  }, [hostEl, measurer]);

  React.useLayoutEffect(() => {
    const handle = surfaceHandleRef.current;
    if (!handle) return;
    handle.interactive = interactive;
    handle.editing = editing;
  });

  React.useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const map = resolveComponentMap(componentsRef.current);
    for (const [id, node] of Object.entries(nodes)) {
      if (node.type === 'root') continue;
      if (!map[node.type]) continue;
      const found = host.querySelector(
        `[data-editor-block="${CSS.escape(id)}"]`,
      );
      if (!found) {
        warnOnce(
          `Canvas.Root: block "${id}" (type "${node.type}") rendered no [data-editor-block] attribute. Spread edit.block on the block's root element. A display: contents wrapper is the documented escape when the component has no single root.`,
        );
      }
    }
  }, [version, nodes]);

  if (surface === 'frame') {
    throw new Error('Canvas.Root: surface "frame" is not implemented');
  }

  void version;

  const map = resolveComponentMap(components);
  const tree = renderStoreTree({
    nodes,
    rootId,
    schema: ctx.schema,
    components: map,
    resolve,
    cache: cacheRef.current,
    edits: editsRef.current,
  });

  const read = React.useMemo(() => {
    const cache = cacheRef.current!;
    return (kind: ResolveKind, value: unknown, spec: BlockProperty) =>
      readResolved(kind, value, spec, resolveRef.current, cache);
  }, []);

  const canvasContext = React.useMemo((): CanvasContextValue => {
    return {
      read,
      host: hostEl,
      measurer,
      pointer,
      dnd,
      interactive,
      dragging,
      editing,
      inlineCaret: inlineCaretRef,
    };
  }, [read, hostEl, measurer, pointer, dnd, interactive, dragging, editing]);

  const host = useRender<'div', CanvasRootState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      ref: composeRefs(rest.ref, hostRef),
      children: (
        <>
          {tree}
          <CanvasDndEffects />
          {children}
        </>
      ),
    },
    state: {
      interactive,
      dragging,
      editing,
      editorCanvas: true,
    },
  });

  const content = (
    <CanvasContext.Provider value={canvasContext}>
      {host}
    </CanvasContext.Provider>
  );

  if (outerSession !== null) return content;

  return (
    <CanvasSessionContext.Provider value={session}>
      {content}
    </CanvasSessionContext.Provider>
  );
}

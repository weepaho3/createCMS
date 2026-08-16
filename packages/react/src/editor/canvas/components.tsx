import type { BlockProperty } from '@createcms/schema';

import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { CanvasResolveContextValue } from './context';
import type { CanvasComponents } from './map';
import type { CanvasResolve, ResolveKind } from './resolve';

import { composeRefs, useRender } from '../../use-render';
import { useEditorSelector } from '../binding';
import { useEditorContext } from '../context';
import { CanvasResolveContext } from './context';
import { createEditCache, type EditCache } from './edit';
import { handleCanvasClick, handleCanvasPointerOver } from './interact';
import { resolveComponentMap } from './map';
import { renderStoreTree } from './renderer';
import { createResolveCache, readResolved, type ResolveCache } from './resolve';

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

  React.useLayoutEffect(() => {
    const host = hostRef.current;
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
    host.addEventListener('click', onClick, true);
    host.addEventListener('pointerover', onPointerOver);
    return () => {
      host.removeEventListener('click', onClick, true);
      host.removeEventListener('pointerover', onPointerOver);
    };
  }, [version]);

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

  const resolveContext = React.useMemo((): CanvasResolveContextValue => {
    const cache = cacheRef.current!;
    return {
      read(kind: ResolveKind, value: unknown, spec: BlockProperty) {
        return readResolved(kind, value, spec, resolveRef.current, cache);
      },
    };
  }, []);

  const host = useRender<'div', CanvasRootState>({
    defaultTagName: 'div',
    render,
    props: {
      ...rest,
      ref: composeRefs(rest.ref, hostRef),
      children: (
        <>
          {tree}
          {children}
        </>
      ),
    },
    state: {
      interactive,
      dragging: false,
      editing,
      editorCanvas: true,
    },
  });

  return (
    <CanvasResolveContext.Provider value={resolveContext}>
      {host}
    </CanvasResolveContext.Provider>
  );
}

import * as React from 'react';

import type { AnyEditorSchema } from '../core/schema';
import type { EditorStore } from '../core/store';
import type { EditCache } from './edit';
import type { InlineRichTextStore } from './inline-rich-text';
import type { CanvasComponent } from './map';
import type { CanvasResolve, ResolveCache } from './resolve';

import { useStoreDocSelector, useStoreSessionSelector } from '../binding';
import { warnOnce } from '../core/codes';
import { DEFAULT_SLOT, fieldsOf, slotsOf } from '../core/schema';
import {
  BlockErrorBoundary,
  CanvasBlockError,
  CanvasUnknownBlock,
  renderError,
} from './boundary';
import { withEmptyFieldPlaceholder } from './inline-text';
import { resolveNodeProperties } from './resolve';

/** A counter that bumps when a pending resolution settles. */
export type ResolveTick = {
  get(): number;
  bump(): void;
  subscribe(listener: () => void): () => void;
};

export function createResolveTick(): ResolveTick {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    bump() {
      value += 1;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * What every block view needs. The value changes only when the schema, the
 * component map or the resolvers change, never per document update.
 */
export type CanvasRenderDeps = {
  readonly store: EditorStore;
  readonly schema: AnyEditorSchema;
  readonly components: Readonly<Record<string, CanvasComponent>>;
  readonly resolve: CanvasResolve | undefined;
  readonly cache: ResolveCache;
  readonly edits: EditCache;
  readonly tick: ResolveTick;
  /** Runs after a block mounted or changed its type (anchor checks). */
  onBlockRendered(id: string, type: string): void;
  /** Renders props through `useDeferredValue` (read-only previews). */
  readonly deferUpdates: boolean;
  /** Top-level blocks per `content-visibility` chunk; `undefined` renders no chunks. */
  readonly chunkSize: number | undefined;
  /** An in-place rich text session freezes its field's rendered value. */
  readonly inlineRichText: InlineRichTextStore;
  /** Whether a drag runs: chunks then render fully so every target measures. */
  isDragging(): boolean;
  subscribeDragging(listener: () => void): () => void;
  /** Replaces `Canvas.BlockError` for a block that threw. */
  readonly renderBlockError:
    | ((info: BlockErrorInfo) => React.ReactNode)
    | undefined;
  /** Replaces `Canvas.UnknownBlock` for a type without a component. */
  readonly renderUnknownBlock:
    | ((info: UnknownBlockInfo) => React.ReactNode)
    | undefined;
};

/** What a block error fallback receives. */
export type BlockErrorInfo = {
  readonly blockId: string;
  readonly blockType: string;
  readonly error: unknown;
};

/** What an unknown block fallback receives. */
export type UnknownBlockInfo = {
  readonly blockId: string;
  readonly blockType: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly slots: Readonly<Record<string, React.ReactNode>>;
};

export const CanvasRenderContext = React.createContext<CanvasRenderDeps | null>(
  null,
);

function useRenderDeps(name: string): CanvasRenderDeps {
  const deps = React.useContext(CanvasRenderContext);
  if (!deps) throw new Error(`${name} must be used within a Canvas.Root.`);
  return deps;
}

const NO_IDS: readonly string[] = [];

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a === b || (a.length === b.length && a.every((id, i) => id === b[i]));
}

const CHUNK_STYLE: React.CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: 'auto 600px',
};
const CHUNK_STYLE_DRAGGING: React.CSSProperties = {
  contentVisibility: 'visible',
  containIntrinsicSize: 'auto 600px',
};

/**
 * The root's blocks in groups of `size`, each group in a wrapper with
 * `content-visibility: auto`, so off-screen groups skip layout and paint.
 * During a drag every group renders fully: drop targets and overlays
 * measure everywhere.
 */
const ChunkedSlotView = React.memo(function ChunkedSlotView({
  parentId,
  slot,
  size,
}: {
  parentId: string;
  slot: string;
  size: number;
}) {
  const deps = useRenderDeps('ChunkedSlotView');
  const ids = useStoreDocSelector(
    deps.store,
    (state) => state.nodes[parentId]?.slots[slot] ?? NO_IDS,
    sameIds,
  );
  const dragging = React.useSyncExternalStore(
    deps.subscribeDragging,
    deps.isDragging,
    () => false,
  );
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size)
    chunks.push(ids.slice(i, i + size));
  return (
    <>
      {chunks.map((chunk, index) => (
        <div
          // Chunk positions, not ids: a move between chunks keeps the wrappers.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          data-editor-chunk=""
          style={dragging ? CHUNK_STYLE_DRAGGING : CHUNK_STYLE}
        >
          {chunk.map((id) => (
            <BlockView key={id} id={id} />
          ))}
        </div>
      ))}
    </>
  );
});

/** One slot of one node: re-renders only when that slot's ids change. */
export const SlotView = React.memo(function SlotView({
  parentId,
  slot,
}: {
  parentId: string;
  slot: string;
}) {
  const { store } = useRenderDeps('SlotView');
  const ids = useStoreDocSelector(
    store,
    (state) => state.nodes[parentId]?.slots[slot] ?? NO_IDS,
    sameIds,
  );
  if (ids.length === 0) return null;
  return (
    <>
      {ids.map((id) => (
        <BlockView key={id} id={id} />
      ))}
    </>
  );
});

type BlockSlice = {
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly slotNames: readonly string[];
};

function sameSlice(a: BlockSlice | null, b: BlockSlice | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.type === b.type &&
    a.props === b.props &&
    sameIds(a.slotNames, b.slotNames)
  );
}

/**
 * One node: its component with resolved props, edit anchors and one
 * `SlotView` per slot. Re-renders only when the node's type, props or slot
 * names change (or a resolution of its values settles), not when other
 * nodes or the order inside its slots change.
 */
export const BlockView = React.memo(function BlockView({ id }: { id: string }) {
  const deps = useRenderDeps('BlockView');
  const { store, schema } = deps;
  const liveSlice = useStoreDocSelector(
    store,
    (state): BlockSlice | null => {
      const node = state.nodes[id];
      if (!node) return null;
      const declared = Object.keys(slotsOf(schema, node.type));
      const extra = Object.keys(node.slots).filter(
        (name) => !declared.includes(name),
      );
      return {
        type: node.type,
        props: node.props,
        slotNames:
          extra.length === 0 ? declared : [...declared, ...extra.sort()],
      };
    },
    sameSlice,
  );
  // A constant when not deferring, so live canvases get no extra render.
  const deferredSlice = React.useDeferredValue(
    deps.deferUpdates ? liveSlice : null,
  );
  const slice = deps.deferUpdates ? deferredSlice : liveSlice;
  const computed = useStoreSessionSelector(
    store,
    (state) => state.computed[id] ?? null,
  );
  const status = useStoreSessionSelector(store, (state) => {
    const entry = state.nodeStatus[id];
    if (!entry) return null;
    return entry.loading ? 'loading' : 'error';
  });
  const tick = React.useSyncExternalStore(
    deps.tick.subscribe,
    deps.tick.get,
    deps.tick.get,
  );

  const type = slice?.type ?? null;
  React.useLayoutEffect(() => {
    if (type !== null) deps.onBlockRendered(id, type);
  }, [deps, id, type]);

  const slotNames = slice?.slotNames ?? NO_IDS;
  const slots = React.useMemo(() => {
    const out: Record<string, React.ReactNode> = {};
    for (const name of slotNames) {
      out[name] = <SlotView parentId={id} slot={name} />;
    }
    return out;
  }, [id, slotNames]);

  const resolved = React.useMemo(() => {
    if (!slice) return null;
    // `tick` invalidates the memo when a pending value settles.
    void tick;
    const { properties, unresolved } = resolveNodeProperties(
      slice.type,
      slice.props,
      schema,
      deps.resolve,
      deps.cache,
    );
    return {
      // `resolveData` results show on top of the stored props.
      props: withEmptyFieldPlaceholder(
        computed ? { ...properties, ...computed } : properties,
        fieldsOf(schema, slice.type),
      ),
      unresolved,
    };
  }, [slice, schema, deps, tick, computed]);

  // While an in-place rich text session edits one of this block's fields,
  // the editor owns that element's DOM: keep rendering the value it started
  // from, so React never reconciles the children the session set aside.
  const frozenKey = React.useSyncExternalStore(
    deps.inlineRichText.subscribe,
    () => {
      const state = deps.inlineRichText.get();
      return state?.blockId === id ? state.key : null;
    },
    () => null,
  );
  const renderedRef = React.useRef<Readonly<Record<string, unknown>> | null>(
    null,
  );
  const frozenRef = React.useRef<{ key: string; value: unknown } | null>(null);
  if (frozenKey === null) frozenRef.current = null;
  else if (frozenRef.current?.key !== frozenKey) {
    frozenRef.current = {
      key: frozenKey,
      value: renderedRef.current?.[frozenKey],
    };
  }
  const frozen = frozenRef.current;
  const props =
    resolved && frozen
      ? { ...resolved.props, [frozen.key]: frozen.value }
      : (resolved?.props ?? null);
  renderedRef.current = props;

  const blockTypeForFallback = slice?.type ?? '';
  const renderFallback = React.useCallback(
    (error: unknown): React.ReactNode =>
      deps.renderBlockError ? (
        deps.renderBlockError({
          blockId: id,
          blockType: blockTypeForFallback,
          error,
        })
      ) : (
        <CanvasBlockError
          blockId={id}
          blockType={blockTypeForFallback}
          error={error}
        />
      ),
    [deps, id, blockTypeForFallback],
  );

  if (!slice || !resolved) return null;
  if (slice.type === 'root') {
    if (deps.chunkSize !== undefined) {
      return (
        <ChunkedSlotView
          parentId={id}
          slot={DEFAULT_SLOT}
          size={deps.chunkSize}
        />
      );
    }
    return <>{slots[DEFAULT_SLOT] ?? null}</>;
  }
  const blockType = slice.type;

  const Component = deps.components[blockType];
  if (!Component) {
    if (process.env.NODE_ENV !== 'production') {
      warnOnce(
        'E006',
        `Canvas.Root: no component mapped for block type "${blockType}"`,
      );
    }
    const info = { blockId: id, blockType, props: slice.props, slots };
    return deps.renderUnknownBlock ? (
      deps.renderUnknownBlock(info)
    ) : (
      <CanvasUnknownBlock {...info} />
    );
  }

  return (
    <BlockErrorBoundary
      resetKey={slice}
      fallback={renderFallback}
      onError={(error, componentStack) => {
        if (process.env.NODE_ENV !== 'production') {
          warnOnce(
            'E009',
            `block "${id}" (type "${blockType}") threw while rendering`,
          );
        }
        deps.store.reportError(
          renderError(error, id, blockType, componentStack),
        );
      }}
    >
      <Component
        id={id}
        type={blockType}
        props={props ?? resolved.props}
        edit={deps.edits.get(
          id,
          blockType,
          schema,
          resolved.unresolved,
          status,
        )}
        slots={slots}
      >
        {slots[DEFAULT_SLOT] ?? null}
      </Component>
    </BlockErrorBoundary>
  );
});

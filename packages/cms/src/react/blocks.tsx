import type { ReactNode } from 'react';

import { Fragment } from 'react';

import type { BlockTreeNode } from '../core/blocks/reconstruct-snapshot';
import type {
  AnnotatedBlockTreeNode,
  BlockDiffAnnotation,
  TextDiffSegment,
} from '../core/diff/types';
import type {
  AnyBlockDefinition,
  AnyCollectionDefinition,
  BlockProperty,
  CollectionDefinition,
  EventDeclaration,
  InferBlockProperties,
  RefMode,
} from '../core/types/definitions';

import { isResolvedReference } from '../core/references-guard';
import { BlockTracker } from './tracking';

// Re-export the canonical resolved-reference guard from its pure module, so
// `@createcms/core/react` keeps exposing `isResolvedReference` unchanged.
export { isResolvedReference } from '../core/references-guard';

// Re-export the diff annotation shapes from the core contract, so render-layer
// consumers (custom `wrap` callbacks, richText diff rendering) can type against
// them without importing core internals.
export type {
  AnnotatedBlockTreeNode,
  BlockDiffAnnotation,
  TextDiffSegment,
} from '../core/diff/types';

// `RefMode` — which side of the reference seam a component's props reflect:
// `raw` (store values — the editor canvas) or `resolved` (published read) — is
// imported from `../core/types/definitions` (re-exported from the package root).

// ============================================================================
// Type-level utilities
// ============================================================================

/** Props passed to each block component in the renderer map. The default
 *  renderer consumes RESOLVED content (getPublishedContent), so `reference`
 *  properties surface as `ResolvedReference` objects — hence `M` defaults to
 *  `'resolved'`. Pass `M = 'raw'` to type a dual-use component against the raw
 *  store values the editor canvas holds (`reference` → stored rootId string),
 *  instead of falling back to `any`. */
export type BlockComponentProps<
  TProps extends Record<string, BlockProperty> = Record<string, BlockProperty>,
  M extends RefMode = 'resolved',
> = {
  properties: InferBlockProperties<TProps, M>;
  children: ReactNode;
  blockId: string;
  node: BlockTreeNode;
};

/** Shorthand to derive block component props from a collection definition.
 *  `blocks` is optional on `CollectionDefinition`, so the constraint accepts the
 *  optional shape and `NonNullable` resolves it — passing `typeof myCollection`
 *  directly works, and `TBlock` autocompletes the collection's block names. */
export type BlockProps<
  TCollection extends { blocks?: Record<string, AnyBlockDefinition> },
  TBlock extends keyof NonNullable<TCollection['blocks']> & string,
> = BlockComponentProps<
  NonNullable<TCollection['blocks']>[TBlock]['properties']
>;

/** A total component map: one React component per block type of a collection. */
export type BlockComponentMap<
  TBlocks extends Record<string, AnyBlockDefinition>,
> = {
  [K in keyof TBlocks & string]: (
    props: BlockComponentProps<TBlocks[K]['properties']>,
  ) => ReactNode;
};

// ============================================================================
// BlocksMap
// ============================================================================

/**
 * Opaque handle returned by `createBlocksMap`. Pass it to `<BlocksRenderer>`.
 * Carries the React component map, the per-block-type event declarations (the
 * runtime half of the M2a typed-events seam, so the renderer can tell a
 * functional block from a presentational one), AND the collection definition
 * itself. Bundling the collection means an editor can consume a single object
 * for both rendering (`_components`) and schema/placement/grouping
 * (`_collection`) — no separate `collection` handoff. The type parameter is
 * preserved so that consumption stays typed; it defaults to the erased
 * `AnyCollectionDefinition` for plain `BlocksMap` annotations.
 */
export type BlocksMap<TCollection = AnyCollectionDefinition> = {
  readonly __brand: 'BlocksMap';
  readonly _components: Record<string, (props: any) => ReactNode>;
  readonly _events: Record<string, Record<string, EventDeclaration>>;
  readonly _collection: TCollection;
};

/**
 * Blessed accessor for the collection definition a `BlocksMap` carries. Use
 * this instead of reaching into the `_collection` underscore internal: editors
 * consuming the map for schema/placement/grouping go through here, so the
 * `BlocksMap` shape can evolve without breaking them. The `TCollection` type
 * parameter is preserved, so `getCollection(pageBlocks)` stays fully typed.
 */
export function getCollection<TCollection>(
  map: BlocksMap<TCollection>,
): TCollection {
  return map._collection;
}

/**
 * Blessed accessor for the React component map a `BlocksMap` carries. Use this
 * instead of reaching into the `_components` underscore internal — e.g. an
 * editor canvas that renders blocks itself rather than via `<BlocksRenderer>`.
 */
export function getComponents(
  map: BlocksMap<unknown>,
): Record<string, (props: any) => ReactNode> {
  return map._components;
}

/**
 * Extracts the per-block-type event declarations from a collection definition —
 * the runtime half of the M2a typed-events seam. Only functional blocks (those
 * that declared a non-empty `events`) get an entry; presentational blocks are
 * omitted, so `type in blocksMap._events` is the runtime "is this block
 * functional?" test the M3 BlockTracker keys on.
 */
export function extractBlockEvents(
  blocks: Record<string, AnyBlockDefinition> | undefined,
): Record<string, Record<string, EventDeclaration>> {
  const out: Record<string, Record<string, EventDeclaration>> = {};
  if (!blocks) return out;
  for (const [type, def] of Object.entries(blocks)) {
    if (def.events && Object.keys(def.events).length > 0) {
      // Shallow-copy so the map OWNS its event records (the `readonly` on
      // BlocksMap._events is a real contract): never alias the live collection
      // definition, so a consumer can't mutate it through the map.
      out[type] = { ...def.events };
    }
  }
  return out;
}

/**
 * Creates a type-safe block component map for a CMS collection. Pass the
 * collection DEFINITION (the runtime object) as the single source of truth:
 * the component-prop types are inferred from its blocks, and its `events`
 * declarations are carried into the map for the M3 tracker.
 *
 * @example
 * ```tsx
 * import { createBlocksMap } from '@createcms/core/react';
 * import { pagesCollection } from '@/cms/collections/pages/definition';
 *
 * export const pageBlocks = createBlocksMap(pagesCollection, {
 *   headline: ({ properties }) => <h1>{properties.text}</h1>,
 *   hero: ({ properties, children }) => (
 *     <section>
 *       <h1>{properties.headline}</h1>
 *       {children}
 *     </section>
 *   ),
 * });
 * ```
 */
export function createBlocksMap<
  TProps extends Record<string, BlockProperty>,
  TBlocks extends Record<string, AnyBlockDefinition>,
>(
  collection: CollectionDefinition<TProps, TBlocks>,
  components: BlockComponentMap<TBlocks>,
): BlocksMap<CollectionDefinition<TProps, TBlocks>> {
  return {
    __brand: 'BlocksMap' as const,
    _components: components as Record<string, (props: any) => ReactNode>,
    _events: extractBlockEvents(collection.blocks),
    _collection: collection,
  };
}

// ============================================================================
// Diff-aware rendering
// ============================================================================

/**
 * Options for diff-aware rendering. Pass as the `diff` prop of
 * `<BlocksRenderer>` (or the component returned by `createContentRenderer`)
 * when rendering the annotated tree produced by `getDiff({ view: 'tree' })`.
 * Rendering without the prop is byte-identical to a plain render.
 */
export type BlocksDiffOptions = {
  /** Wrap a changed block's rendered element. Default emits <div data-diff=...>. */
  wrap?: (args: {
    element: ReactNode;
    node: AnnotatedBlockTreeNode;
    annotation: BlockDiffAnnotation;
  }) => ReactNode;
};

/**
 * Typed accessor for the diff annotation an `AnnotatedBlockTreeNode` carries.
 * Annotated trees are structurally assignable to `BlockTreeNode`, so block
 * components receive them through the ordinary `node` prop — this reads the
 * annotation back out without casting. Returns `null` for unchanged nodes and
 * for plain (non-diff) trees.
 */
export function getBlockDiff(node: BlockTreeNode): BlockDiffAnnotation | null {
  return (node as AnnotatedBlockTreeNode).diff ?? null;
}

/** A full HTML tag captured as one atomic token — the same tag grammar the
 *  `diffRichText` tokenizer splits on, so segment boundaries and emission
 *  boundaries agree. */
const HTML_TAG_SPLIT = /(<[^>]*>)/;
const HTML_TAG_TOKEN = /^<[^>]*>$/;

/**
 * Serializes word-level `richText` diff segments back into one HTML fragment
 * whose tag structure is exactly the NEW document's. Segments may contain HTML
 * tags (a formatting or block-tag change diffs as inserted/deleted tag tokens),
 * and tags must never be wrapped in — or interleaved with — `<ins>`/`<del>`,
 * so emission is tag-aware:
 *
 * - `same` runs pass through raw.
 * - `ins` runs emit their tag tokens bare (they ARE the new structure) and wrap
 *   each run of consecutive text tokens in `<ins data-diff-text="ins">`.
 * - `del` runs DROP their tag tokens entirely (the old structure must not leak
 *   into the new document) and wrap each run of consecutive text tokens in
 *   `<del data-diff-text="del">` — deleted text survives tag-stripped, deleted
 *   tags do not.
 *
 * Consequently a formatting-only change (bolding a word, `<p>` → `<div>`)
 * yields valid output with NO inline highlight: the diff is pure tags, and
 * tags are never marked. The result feeds the same `dangerouslySetInnerHTML`
 * path the docs already describe for `richText` properties; consumers style
 * `ins`/`del` via CSS.
 */
export function diffSegmentsToHtml(segments: TextDiffSegment[]): string {
  let out = '';

  for (const segment of segments) {
    if (segment.type === 'same') {
      out += segment.html;
      continue;
    }

    const marker = segment.type; // 'ins' | 'del'
    let textRun = '';
    const flushTextRun = () => {
      if (textRun === '') return;
      out += `<${marker} data-diff-text="${marker}">${textRun}</${marker}>`;
      textRun = '';
    };

    for (const token of segment.html.split(HTML_TAG_SPLIT)) {
      if (token === '') continue;
      if (HTML_TAG_TOKEN.test(token)) {
        flushTextRun();
        // Inserted tags are the new document's structure — emit bare. Deleted
        // tags are the OLD structure — drop them.
        if (marker === 'ins') out += token;
      } else {
        textRun += token;
      }
    }
    flushTextRun();
  }

  return out;
}

// Change types that trigger a wrapper, in `data-diff` priority order. A PURE
// `childrenReordered` annotation is deliberately excluded — highlighting a
// parent because its children swapped places is visual noise; the moved
// children themselves carry `moved`.
const WRAPPED_CHANGE_TYPES = ['added', 'deleted', 'modified', 'moved'] as const;

/**
 * Wraps a changed node's rendered element per the diff options. Returns the
 * element unchanged for unannotated nodes and for pure-`childrenReordered`
 * annotations.
 */
function applyDiffWrapper(
  element: ReactNode,
  node: BlockTreeNode,
  diff: BlocksDiffOptions,
): ReactNode {
  const annotation = getBlockDiff(node);
  if (!annotation) return element;

  const primary = WRAPPED_CHANGE_TYPES.find((type) =>
    annotation.changeTypes.includes(type),
  );
  if (!primary) return element;

  if (diff.wrap) {
    return (
      <Fragment key={node.blockId}>
        {diff.wrap({
          element,
          node: node as AnnotatedBlockTreeNode,
          annotation,
        })}
      </Fragment>
    );
  }

  // Unique first path segments of the property changes (string keys only —
  // array indices never appear at the top level of a properties object).
  const changedTopLevelProps = annotation.propertyChanges
    ? [
        ...new Set(
          annotation.propertyChanges
            .map((change) => change.path[0])
            .filter(
              (segment): segment is string => typeof segment === 'string',
            ),
        ),
      ].join(' ')
    : '';

  return (
    <div
      key={node.blockId}
      data-diff={primary}
      data-diff-types={annotation.changeTypes.join(' ')}
      data-diff-props={changedTopLevelProps || undefined}
    >
      {element}
    </div>
  );
}

// ============================================================================
// BlocksRenderer
// ============================================================================

/**
 * Renders a `BlockTreeNode` tree using a block component map.
 *
 * Delegates to the reference-aware `renderContentNode`, which is a strict
 * superset: for the reference-free trees that `getBlockTree` produces it
 * behaves identically, and it additionally resolves inline references should a
 * tree ever carry them.
 *
 * @example
 * ```tsx
 * import { BlocksRenderer } from '@createcms/core/react/blocks';
 * import { pageBlocks } from '@/lib/blocks/pages';
 *
 * export default async function Page() {
 *   const tree = await cms.api.pages.getBlockTree(...);
 *   return <BlocksRenderer blocks={pageBlocks} tree={tree} />;
 * }
 * ```
 */
export function BlocksRenderer({
  blocks,
  tree,
  diff,
}: {
  blocks: BlocksMap;
  tree: BlockTreeNode;
  /** Opt-in diff-aware rendering for annotated trees (`getDiff`). */
  diff?: BlocksDiffOptions;
}): ReactNode {
  return renderContentNode(tree, blocks._components, blocks._events, diff);
}

// ============================================================================
// ContentRenderer (reference-aware tree rendering)
// ============================================================================

function renderContentNode(
  node: BlockTreeNode,
  components: Record<string, (props: any) => ReactNode>,
  events: Record<string, Record<string, EventDeclaration>>,
  diff?: BlocksDiffOptions,
  fromReference = false,
): ReactNode {
  const rendered = renderNodeElement(
    node,
    components,
    events,
    diff,
    fromReference,
  );
  // Diff wrapping is applied OUTSIDE the node's own render: never for the root
  // (it renders as a bare fragment) and never when the node rendered nothing.
  if (!diff || node.type === 'root' || rendered === null) return rendered;
  return applyDiffWrapper(rendered, node, diff);
}

function renderNodeElement(
  node: BlockTreeNode,
  components: Record<string, (props: any) => ReactNode>,
  events: Record<string, Record<string, EventDeclaration>>,
  diff: BlocksDiffOptions | undefined,
  fromReference: boolean,
): ReactNode {
  const renderedChildren = node.children.map((child) =>
    renderContentNode(child, components, events, diff, fromReference),
  );

  const childrenNode =
    renderedChildren.length > 0 ? <>{renderedChildren}</> : null;

  if (node.type === 'root') {
    return <>{childrenNode}</>;
  }

  const Component = components[node.type];

  if (!Component) {
    // No component mapped for this block type.
    // Check if any property is a resolved reference with a tree —
    // if so, render the referenced tree inline using the same components.
    for (const value of Object.values(node.properties)) {
      if (isResolvedReference(value) && value.tree.children.length > 0) {
        const refChildren = value.tree.children.map((child) => (
          <Fragment key={child.blockId}>
            {renderContentNode(child, components, events, diff, true)}
          </Fragment>
        ));
        return <>{refChildren}</>;
      }
    }

    // Blocks from referenced data-only collections won't have a mapped
    // component — that's expected, not an error.
    if (!fromReference && process.env.NODE_ENV !== 'production') {
      console.warn(`[cms] No component mapped for block type "${node.type}"`);
    }
    return null;
  }

  // If the block has reference properties with block trees, render them
  // and pass as children (appended after the block's own children). The same
  // `events` map flows down so a functional block embedded via a reference
  // still binds to the host page's ambient ab-context.
  let refRendered: ReactNode[] = [];
  for (const value of Object.values(node.properties)) {
    if (isResolvedReference(value) && value.tree.children.length > 0) {
      for (const child of value.tree.children) {
        refRendered.push(
          <Fragment key={child.blockId}>
            {renderContentNode(child, components, events, diff, true)}
          </Fragment>,
        );
      }
    }
  }

  const allChildren =
    renderedChildren.length > 0 || refRendered.length > 0 ? (
      <>
        {renderedChildren}
        {refRendered}
      </>
    ) : null;

  const element = (
    <Component
      key={node.blockId}
      properties={node.properties}
      children={allChildren}
      blockId={node.blockId}
      node={node}
    />
  );

  // M3c — a FUNCTIONAL block (declared `events`, carried in BlocksMap._events)
  // is wrapped in the 'use client' <BlockTracker> so it can fire its declared
  // events. children-as-props: `element` is server-rendered and just passed
  // through, so presentational subtrees stay RSC. The dispatch + ab-context come
  // from the consumer's <TrackingRuntimeProvider>, not from here.
  //
  // EXCEPT ghost nodes: a `deleted`-annotated node only exists in diff trees
  // (getDiff re-inserts deleted blocks for review), so it is review-only UI —
  // it must never fire impressions/events. Skipping the tracker leaves any
  // fire() inside it unscoped (no source, dev-warned), instead of attributing
  // events to a block the draft removed.
  const isGhost = getBlockDiff(node)?.changeTypes.includes('deleted') === true;
  if (node.type in events && !isGhost) {
    const rawTrackingId = node.properties.trackingId;
    return (
      <BlockTracker
        key={node.blockId}
        blockType={node.type}
        blockId={node.blockId}
        trackingId={
          typeof rawTrackingId === 'string' ? rawTrackingId : undefined
        }
        events={events[node.type]}
      >
        {element}
      </BlockTracker>
    );
  }

  return element;
}

/**
 * Renders a block tree with automatic reference resolution.
 *
 * When a block has a `reference` property that was resolved by
 * `getPublishedContent`, the referenced block tree is rendered inline
 * using the same block components. Data-only references (collections
 * without blocks) are available directly in `properties`.
 *
 * @example
 * ```tsx
 * import { createContentRenderer } from '@createcms/core/react';
 * import { pagesCollection } from '@/cms/collections/pages/definition';
 *
 * const RenderPage = createContentRenderer(pagesCollection, {
 *   headline: ({ properties }) => <h1>{properties.text}</h1>,
 *   paragraph: ({ properties }) => <p>{properties.text}</p>,
 *   authorCard: ({ properties }) => (
 *     <div>{properties.author.properties.name}</div>
 *   ),
 *   // No component needed for blocks that just embed a referenced tree —
 *   // the referenced content renders inline automatically.
 * });
 *
 * // Usage:
 * <RenderPage tree={tree} />
 * ```
 */
export function createContentRenderer<
  TProps extends Record<string, BlockProperty>,
  TBlocks extends Record<string, AnyBlockDefinition>,
>(
  collection: CollectionDefinition<TProps, TBlocks>,
  components: Partial<BlockComponentMap<TBlocks>>,
) {
  const componentMap = components as Record<string, (props: any) => ReactNode>;
  const events = extractBlockEvents(collection.blocks);

  function ContentRendererComponent({
    tree,
    diff,
  }: {
    tree: BlockTreeNode;
    /** Opt-in diff-aware rendering for annotated trees (`getDiff`). */
    diff?: BlocksDiffOptions;
  }): ReactNode {
    return renderContentNode(tree, componentMap, events, diff);
  }

  ContentRendererComponent.displayName = `ContentRenderer(${collection.label})`;

  return ContentRendererComponent;
}

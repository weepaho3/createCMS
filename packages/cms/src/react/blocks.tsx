import type { ReactNode } from 'react';
import { Fragment } from 'react';

import type { BlockTreeNode } from '../core/blocks/reconstruct-snapshot';
import type {
  AnyBlockDefinition,
  AnyCollectionDefinition,
  BlockProperty,
  CollectionDefinition,
  EventDeclaration,
  InferBlockProperties,
  ResolvedReference,
} from '../core/types/definitions';

import { BlockTracker } from './tracking';

// ============================================================================
// Type-level utilities
// ============================================================================

/** Props passed to each block component in the renderer map. The renderer
 *  consumes RESOLVED content (getPublishedContent), so `reference` properties
 *  surface as `ResolvedReference` objects — the `resolved` inference mode. */
export type BlockComponentProps<
  TProps extends Record<string, BlockProperty> = Record<string, BlockProperty>,
> = {
  properties: InferBlockProperties<TProps, 'resolved'>;
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

type BlockComponentMap<TBlocks extends Record<string, AnyBlockDefinition>> = {
  [K in keyof TBlocks & string]: (
    props: BlockComponentProps<TBlocks[K]['properties']>,
  ) => ReactNode;
};

export function isResolvedReference(
  value: unknown,
): value is ResolvedReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    'rootId' in value &&
    'collection' in value &&
    'tree' in value &&
    'properties' in value
  );
}

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
}: {
  blocks: BlocksMap;
  tree: BlockTreeNode;
}): ReactNode {
  return renderContentNode(tree, blocks._components, blocks._events);
}

// ============================================================================
// createBlocksRenderer (convenience shorthand)
// ============================================================================

/**
 * Creates a type-safe block renderer component for a CMS collection.
 * Convenience shorthand that combines `createBlocksMap` + `BlocksRenderer`.
 *
 * @example
 * ```tsx
 * import { createBlocksRenderer } from '@createcms/core/react';
 * import { pagesCollection } from '@/cms/collections/pages/definition';
 *
 * const PageBlocks = createBlocksRenderer(pagesCollection, {
 *   headline: ({ properties }) => <h1>{properties.text}</h1>,
 *   hero: ({ properties, children }) => (
 *     <section>
 *       <h1>{properties.headline}</h1>
 *       {children}
 *     </section>
 *   ),
 * });
 *
 * // In a page component:
 * <PageBlocks tree={tree} />
 * ```
 */
export function createBlocksRenderer<
  TProps extends Record<string, BlockProperty>,
  TBlocks extends Record<string, AnyBlockDefinition>,
>(
  collection: CollectionDefinition<TProps, TBlocks>,
  components: BlockComponentMap<TBlocks>,
) {
  const blocksMap = createBlocksMap(collection, components);

  function Renderer({ tree }: { tree: BlockTreeNode }): ReactNode {
    return <BlocksRenderer blocks={blocksMap} tree={tree} />;
  }

  Renderer.displayName = `BlocksRenderer(${collection.label})`;

  return Renderer;
}

// ============================================================================
// ContentRenderer (reference-aware tree rendering)
// ============================================================================

function renderContentNode(
  node: BlockTreeNode,
  components: Record<string, (props: any) => ReactNode>,
  events: Record<string, Record<string, EventDeclaration>>,
  fromReference = false,
): ReactNode {
  const renderedChildren = node.children.map((child) =>
    renderContentNode(child, components, events, fromReference),
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
            {renderContentNode(child, components, events, true)}
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
            {renderContentNode(child, components, events, true)}
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
  if (node.type in events) {
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
  }: {
    tree: BlockTreeNode;
  }): ReactNode {
    return renderContentNode(tree, componentMap, events);
  }

  ContentRendererComponent.displayName = `ContentRenderer(${collection.label})`;

  return ContentRendererComponent;
}

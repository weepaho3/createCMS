import type { AnyBlockDefinition } from './blocks';
import type { AnyCollectionDefinition } from './collection';
import type {
  BlockProperty,
  InferBlockProperties,
  RefMode,
} from './properties';

export type BlockTreeNode = {
  blockId: string;
  type: string;
  properties: Record<string, unknown>;
  children: BlockTreeNode[];
};

// ============================================================================
// Read Response Types (typed by the collection definition)
// ============================================================================

/**
 * A block tree node as returned by read endpoints (`getBlockTree`,
 * `getPublishedContent`), typed by the collection's block definitions.
 *
 * It is a discriminated union over `type` — narrow on `node.type` to get the
 * matching `properties`. A `root` member carries the collection's root
 * properties (the top-level node of a tree is always `type: 'root'`).
 *
 * The types reflect the *current* collection definition. Content stored
 * against an older definition (before a schema change) may differ at runtime —
 * that is a data-migration concern, not a type error.
 */
export type InferBlockTreeNode<
  TBlocks extends Record<string, AnyBlockDefinition>,
  TRootProps extends Record<string, BlockProperty> = Record<string, never>,
  M extends RefMode = 'raw',
  TCol extends Record<string, AnyCollectionDefinition> = {},
> =
  | {
      [K in keyof TBlocks & string]: {
        blockId: string;
        type: K;
        properties: NonNullable<
          InferBlockProperties<TBlocks[K]['properties'], M, TCol>
        >;
        children: InferBlockTreeNode<TBlocks, TRootProps, M, TCol>[];
      };
    }[keyof TBlocks & string]
  | {
      blockId: string;
      type: 'root';
      properties: NonNullable<InferBlockProperties<TRootProps, M, TCol>>;
      children: InferBlockTreeNode<TBlocks, TRootProps, M, TCol>[];
    };

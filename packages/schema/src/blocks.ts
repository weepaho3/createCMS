import type { EventDeclaration } from './events';
import type {
  BlockProperty,
  InferBlockProperties,
  InferPartialBlockProperties,
} from './properties';

export type BlockDefinition<
  TProps extends Record<string, BlockProperty> = Record<string, BlockProperty>,
  TEvents extends Record<string, EventDeclaration> = Record<string, never>,
> = {
  properties: TProps;
  label: string;
  description?: string;
  previewImageUrl?: string;
  /**
   * Editor hint: the block-picker category this block is shown under (e.g.
   * `'Forms'`, `'Layout'`). Purely presentational, the editor groups blocks by
   * this label and the package never acts on it. Free-form by design; for
   * consistent, autocompleted group names across blocks, reference a shared
   * `as const` object (e.g. `group: BLOCK_GROUPS.forms`).
   */
  group?: string;
  /** Events this (functional) block can emit, see {@link EventDeclaration}. */
  events?: TEvents;
} & ({ allowChildren?: false } | { allowChildren: true });

export type AnyBlockDefinition = BlockDefinition<
  Record<string, BlockProperty>,
  Record<string, EventDeclaration>
>;

/** Discriminated union input for creating a block: `{ type: 'paragraph', properties: { text: '...' } }`. */
export type InferBlockInput<
  TBlocks extends Record<string, AnyBlockDefinition>,
> = {
  [K in keyof TBlocks & string]: {
    type: K;
    properties: InferBlockProperties<TBlocks[K]['properties']>;
  };
}[keyof TBlocks & string];

/** createBlock input: routing fields at top level, discriminated block union
 *  nested. Nesting avoids oRPC's Schema brand breaking discriminated-union
 *  autocomplete. */
export type InferCreateBlockInput<
  TBlocks extends Record<string, AnyBlockDefinition>,
> = {
  rootId: string;
  branchId: string;
  parentBlockId: string;
  position?: number;
  message?: string;
  /**
   * Optimistic-concurrency guard: when provided, the mutation is rejected with
   * a typed conflict if the branch head has advanced past this commit id since
   * the caller last read. Enforced in the blocks route.
   */
  expectedHeadCommitId?: string;
} & InferBlockInput<TBlocks>;

/** createMergeBlockVersion input: discriminated union of all block types
 *  (child blocks + root block) with merge-specific routing fields. */
export type InferMergeBlockVersionInput<
  TBlocks extends Record<string, AnyBlockDefinition>,
  TRootProps extends Record<string, BlockProperty> = never,
> = {
  mergeRequestId: string;
  blockId: string;
  children?: string[];
} & (
  | {
      [K in keyof TBlocks & string]: {
        type: K;
        properties: InferBlockProperties<TBlocks[K]['properties']>;
      };
    }[keyof TBlocks & string]
  | ([TRootProps] extends [never]
      ? never
      : { type: 'root'; properties: InferBlockProperties<TRootProps> })
);

/** updateBlock input: identifies the block and provides a partial properties
 *  object. Only supplied fields are merged; omitted fields keep their current
 *  values. When TRootProps is provided, a `type: 'root'` variant is included
 *  for updating the root block's properties. */
export type InferUpdateBlockInput<
  TBlocks extends Record<string, AnyBlockDefinition>,
  TRootProps extends Record<string, BlockProperty> = never,
> = {
  rootId: string;
  branchId: string;
  blockId: string;
  message?: string;
  /**
   * Optimistic-concurrency guard: rejected with a typed conflict if the branch
   * head advanced past this commit id. Enforced in the blocks route.
   */
  expectedHeadCommitId?: string;
} & (
  | {
      [K in keyof TBlocks & string]: {
        type: K;
        properties: InferPartialBlockProperties<TBlocks[K]['properties']>;
      };
    }[keyof TBlocks & string]
  | ([TRootProps] extends [never]
      ? never
      : { type: 'root'; properties: InferPartialBlockProperties<TRootProps> })
);

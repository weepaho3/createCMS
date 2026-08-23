import type { AnyBlockDefinition } from './blocks';
import type { BlockProperty } from './properties';

export type RootDefinition<
  TProps extends Record<string, BlockProperty> = Record<string, BlockProperty>,
> = {
  properties: TProps;
};

/**
 * One PARENT's placement rule inside a collection's {@link CollectionStructure}:
 * which child block types that parent (or the literal `'root'`) may contain.
 * Three mutually-exclusive modes, enforced by the type:
 *
 * - open: `{}` or `{ accepts: '*' }`, holds any block (same as no entry).
 * - whitelist: `{ accepts: ['a', 'b'] }`, fail-closed, a block added to the
 *   collection later is rejected until listed. `excludes` is forbidden here
 *   (a concrete `accepts` already names exactly what is allowed).
 * - blacklist: `{ excludes: ['z'] }` (or `{ accepts: '*', excludes: ['z'] }`),
 *   fail-open, a block added later is accepted.
 *
 * Whether a parent accepts children at all is the separate `allowChildren`
 * gate on the block (the root always accepts children); these rules only
 * refine WHICH children an accepting parent may hold.
 */
export type BlockStructureEntry<TBlockName extends string> =
  | {
      /** `'*'` = open base (optional, for readability). */
      accepts?: '*';
      excludes?: readonly TBlockName[];
    }
  | {
      accepts: readonly TBlockName[];
      /**
       * Forbidden alongside a concrete `accepts` list: the list already names
       * exactly what is allowed, so `excludes` would be ignored.
       */
      excludes?: "Remove 'excludes': a concrete 'accepts' list already defines exactly which blocks are allowed. Use accepts: '*' with excludes for an all-except list.";
    };

/**
 * Placement rules for a collection, keyed by PARENT block name (or the literal
 * `'root'` for the top level). Open by default: a parent with no entry holds any
 * block. The keys and the `accepts` / `excludes` block names autocomplete against
 * the collection's block names and are checked at compile time by
 * {@link defineCollection} (the field type alone enforces this).
 *
 * Single source of truth read by both the visual editor (drop-zone gating) and
 * the server guard (createBlock / moveBlock / duplicateBlock), so they cannot
 * diverge.
 */
export type CollectionStructure<
  TBlocks extends Record<string, AnyBlockDefinition>,
> = {
  [K in keyof TBlocks | 'root']?: BlockStructureEntry<keyof TBlocks & string>;
};

export type SlugConfig =
  | { enabled: false }
  | {
      enabled: true;
      prefix: string;
      allowIndex?: boolean;
      normalize?: boolean;
      nested?: boolean;
    };

export type ResolvedSlugConfig =
  | { enabled: false }
  | {
      enabled: true;
      prefix: string;
      allowIndex: boolean;
      normalize: boolean;
      nested: boolean;
    };

export type CollectionDefinition<
  TProps extends Record<string, BlockProperty> = Record<string, BlockProperty>,
  TBlocks extends Record<string, AnyBlockDefinition> = Record<
    string,
    AnyBlockDefinition
  >,
> = {
  slug?: SlugConfig;
  root: RootDefinition<TProps>;
  blocks?: TBlocks;
  label: string;
  description?: string;
  /**
   * Marks this collection as one whose roots are meant to be EMBEDDED into other
   * roots via a `reference` property (a "reusable block" library). Purely an
   * ergonomic hint for editor pickers and endpoint surfacing; it never gates
   * safety (the delete-in-use guard protects every referenced root regardless).
   */
  reusableBlock?: boolean;
  /**
   * Placement rules keyed by PARENT block name (or `'root'`): which children
   * each container may hold, via `accepts` (whitelist) / `excludes` (blacklist).
   * Read by the editor and the server guard together with each block's
   * `allowChildren` flag. Open by default; a typo in a name is a compile error.
   */
  structure?: CollectionStructure<TBlocks>;
  /**
   * Per-collection branch-protection overrides. Each field set here wins over the
   * global `branchProtection` config for THIS collection only; unset fields
   * inherit the global value (then the default). Lets, e.g., a `reusableBlock`
   * collection opt out of `protectPublishedBranches` while pages keep it. See
   * {@link BranchProtectionConfig}.
   */
  branchProtection?: Partial<BranchProtectionConfig>;
};

export type AnyCollectionDefinition = CollectionDefinition<
  Record<string, BlockProperty>,
  Record<string, AnyBlockDefinition>
>;

export type CollectionWithName = Omit<AnyCollectionDefinition, 'blocks'> & {
  name: string;
  blocks: Record<string, AnyBlockDefinition>;
};

/**
 * Governance for the default ("main") branch and the merge/publish gates.
 * Every field is opt-in; an empty/absent config keeps current behavior.
 */
export type BranchProtectionConfig = {
  /**
   * Lock a branch against direct content mutations for exactly as long as it is
   * published: changes go via another branch + merge, then a re-publish.
   * Unpublishing makes the branch directly editable again. Applies to ANY
   * published branch, not just the default one (a root can have several
   * published branches at once, e.g. A/B variants). A freshly created,
   * never-published branch is freely editable. Default `false`.
   */
  protectPublishedBranches?: boolean;
  /**
   * Whether `executeMerge` requires approvals. Default `false`: a merge needs
   * no approval unless you opt in.
   */
  requireApprovalToMerge?: boolean;
  /**
   * Whether `publishBranch` ALWAYS requires approvals, not just when an
   * approval was explicitly requested. Default `false` (conditional behavior:
   * if approvals were requested they must pass, otherwise publish proceeds).
   */
  requireApprovalBeforePublish?: boolean;
  /**
   * Whether pushing new commits to a merge request's source branch invalidates
   * existing approvals. Default `false`, matching GitHub's default pull-request
   * behavior. Set `true` for GitHub's "Dismiss stale pull request approvals
   * when new commits are pushed" semantics: the gate then only counts approvals
   * recorded against the source branch's current head commit, and a superseded
   * approval fails with `APPROVALS_STALE`.
   */
  dismissStaleApprovals?: boolean;
  /**
   * Minimum distinct approved reviewers required by the merge / publish gates,
   * on top of "all requested reviewers approved". Default `1`.
   */
  requiredReviewers?: number;
};

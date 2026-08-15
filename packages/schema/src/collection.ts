import type { AnyBlockDefinition } from './blocks';
import type { BlockProperty } from './properties';

// ============================================================================
// Collections
// ============================================================================

export type RootDefinition<
  TProps extends Record<string, BlockProperty> = Record<string, BlockProperty>,
> = {
  properties: TProps;
};

/**
 * One PARENT's placement rule inside a collection's {@link CollectionStructure}
 * — declares which child block types that parent (or the literal `'root'`) may
 * contain. There are three mutually-exclusive modes, enforced by the type:
 *
 * - **open** — `{}` or `{ accepts: '*' }`: holds any block. (Same as having no
 *   entry at all; `'*'` is just an explicit, readable form.)
 * - **whitelist** — `{ accepts: ['a', 'b'] }`: holds ONLY `a`/`b`. Fail-closed —
 *   a block added to the collection later is rejected until listed. `excludes`
 *   is forbidden here (a concrete `accepts` already says exactly what's allowed).
 * - **blacklist** — `{ excludes: ['z'] }` (or `{ accepts: '*', excludes: ['z'] }`):
 *   holds anything EXCEPT `z`. Fail-open — a block added later is accepted.
 *
 * Whether a parent accepts children AT ALL is the separate, coarser
 * `allowChildren` gate on the block (the root always accepts children); these
 * rules only refine WHICH children an accepting parent may hold.
 */
export type BlockStructureEntry<TBlockName extends string> =
  | {
      /** `'*'` = open base (optional, for readability). */
      accepts?: '*';
      /** Holds anything except these. */
      excludes?: readonly TBlockName[];
    }
  | {
      /** Holds ONLY these block types. */
      accepts: readonly TBlockName[];
      /**
       * Forbidden alongside a concrete `accepts` list — the list already names
       * exactly what is allowed, so `excludes` would be ignored.
       */
      excludes?: "Remove 'excludes': a concrete 'accepts' list already defines exactly which blocks are allowed. Use accepts: '*' with excludes for an all-except list.";
    };

/**
 * Placement rules for a collection, keyed by PARENT block name (or the literal
 * `'root'` for the top level). Open by default: a parent with no entry holds any
 * block. The keys and the `accepts` / `excludes` block names autocomplete against
 * the collection's block names and are checked at compile time by
 * {@link defineCollection} (the field type alone enforces this — no extra step).
 *
 * This is the single source of truth that the visual editor (drop-zone gating)
 * and the server guard (createBlock / moveBlock / duplicateBlock) both read,
 * alongside each block's `allowChildren` flag, so they can never diverge.
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
   * ergonomic hint — it informs editor pickers and which endpoints to surface; it
   * NEVER gates safety (the delete-in-use guard protects every referenced root
   * regardless of this flag). Any collection can still be a reference target.
   */
  reusableBlock?: boolean;
  /**
   * Placement rules keyed by PARENT block name (or `'root'`) — which children
   * each container may hold, via `accepts` (whitelist) / `excludes` (blacklist)
   * (see {@link CollectionStructure}). Read by the editor and the server guard
   * together with each block's `allowChildren` flag. Open by default; block
   * names are checked at compile time by the field type itself, so a typo is a
   * compile error at the `defineCollection` call site.
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
 * Every field is opt-in; an empty/absent config preserves today's behavior.
 */
export type BranchProtectionConfig = {
  /**
   * Lock a branch against direct content mutations for exactly as long as it is
   * published. Published content is the live, production-facing tree, so it is
   * made immutable in place: changes go via another branch + merge, then a
   * re-publish. Unpublishing a branch makes it directly editable again. This
   * applies to ANY published branch, not just the default one (a root can have
   * several published branches at once, e.g. A/B variants). A freshly created,
   * never-published branch is freely editable. Default `false`.
   */
  protectPublishedBranches?: boolean;
  /**
   * Whether `executeMerge` requires approvals. Default `false` — a merge needs
   * no approval unless you opt in. (Set `true` to gate merges on approvals.)
   */
  requireApprovalToMerge?: boolean;
  /**
   * Whether `publishBranch` ALWAYS requires approvals — not just when an approval
   * was explicitly requested. Default `false` (the existing conditional behavior:
   * if approvals were requested they must pass, otherwise publish proceeds).
   */
  requireApprovalBeforePublish?: boolean;
  /**
   * Whether pushing new commits to a merge request's source branch invalidates
   * existing approvals. Default `false` — an approval keeps counting after a
   * push, matching GitHub's default pull-request behaviour. Set `true` for
   * GitHub's "Dismiss stale pull request approvals when new commits are pushed":
   * the merge gate then only counts approvals recorded against the source
   * branch's current head commit, and a superseded approval fails with
   * `APPROVALS_STALE`.
   */
  dismissStaleApprovals?: boolean;
  /**
   * Minimum distinct approved reviewers required by the merge / publish gates,
   * on top of "all requested reviewers approved". Default `1`.
   */
  requiredReviewers?: number;
};

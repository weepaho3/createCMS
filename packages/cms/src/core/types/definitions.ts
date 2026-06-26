import type { AnyColumn, SQL } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';

import type { BlockTreeNode } from '../blocks/reconstruct-snapshot';
import type { OnNotificationHandler } from '../notifications/types';
import type { ResolvedUserConfig } from '../user/resolve';
import type { DrizzleInstance } from './drizzle';
import type { CMSHookAction, CMSHooks, CMSPlugin } from './plugin';
import type { MediaConfig } from './s3';

// ============================================================================
// Resolved Reference (populated at read time by getPublishedContent)
// ============================================================================

/**
 * One published branch of a root, as a snapshot. Shared by the page-level
 * variant shape and the block-level A/B `variants` (below) so the two can't
 * drift. `properties` mirrors the (depth-1 typed) reference `properties`.
 */
export type PublishedBranchSnapshot<TProps = Record<string, unknown>> = {
  branchId: string;
  isControl: boolean;
  properties: TProps;
  tree: BlockTreeNode;
};

export type ResolvedReference<TProps = Record<string, unknown>> = {
  rootId: string;
  collection: string;
  properties: TProps;
  tree: BlockTreeNode;
  /**
   * Present only when this referenced root has a RUNNING A/B test (AB_FANOUT
   * F2 server fan-out). The server stays a pure, cacheable function: top-level
   * `tree`/`properties` are the CONTROL branch (a no-JS / AB-disabled client
   * renders it as-is), and the client pre-render pass (F3) picks the visitor's
   * variant from `variants` and swaps it in. `variants` includes the control.
   * An OPTIONAL field (not a discriminated union) so `isResolvedReference` —
   * which narrows on `tree`/`properties` — keeps matching.
   */
  abTest?: {
    testId: string;
    trafficPercentage: number;
    variants: PublishedBranchSnapshot<TProps>[];
  };
};

// ============================================================================
// Scope Conditions (plugin-injected query/insert scoping)
// ============================================================================

/**
 * Per-request scope produced by a ScopeConditionFactory.
 * `where` — appended to SELECT/UPDATE/DELETE queries.
 * `insertColumns` — snake_case column name → value pairs merged directly
 *   into the raw SQL INSERT via `scopedInsert` / `scopedInsertBatch`.
 */
export type TableScope = {
  where?: SQL;
  insertColumns?: Record<string, unknown>;
};

/**
 * `roots` scope additionally supports a per-NEW-ENTRY column contributor: a
 * plugin can compute fresh insert columns once per newly-created logical entry
 * (e.g. a freshly minted translation-group id), which the static `insertColumns`
 * channel (same value on every row) can't express. Called once per
 * createRoot / root-duplication. Generic — core names no column. (Seam D.)
 */
export type RootTableScope = TableScope & {
  newEntryColumns?: () => Record<string, unknown>;
  /**
   * Scope columns to EXCLUDE from cross-scope read filtering — columns the
   * plugin varies INDEPENDENTLY of a query so that cross-scope reads (a
   * reference/host/usage that legitimately spans them) must not filter on them.
   * The i18n plugin declares `['language']` (a host/reference in any sibling
   * language still counts; the read path already resolved a specific sibling).
   * Generic — core names no column; passed to `rootScopeConditions` as its
   * `exclude`. Empty/absent → every scope column filters. (Seam D6.)
   */
  crossScopeExclude?: readonly string[];
};

/**
 * A plugin-provided resolver for reference values (rootId / group-key strings),
 * carried on the resolved scope and consumed by the read path and the A/B
 * co-render walk. Core ships an IDENTITY default (`coreReferenceResolver`)
 * reproducing the single-language, no-plugin behaviour byte-for-byte; the i18n
 * plugin supplies a real one that understands translation groups + the fallback
 * chain. Core never names any i18n concept — it knows only this interface.
 *
 * `db` AND `scopeColumns` are passed PER CALL (not closed over): `db` so a
 * caller inside a transaction (e.g. the A/B →running guard under FOR UPDATE)
 * resolves against its own tx handle; `scopeColumns` because the MERGED root
 * scope columns (tenant + language) exist only AFTER every scope factory has
 * run — the i18n factory that builds the resolver sees only its OWN column at
 * build time. The resolver therefore closes over just its resolution POLICY
 * (e.g. the i18n active language + fallback chain). `scopeColumns` is the
 * scope predicate; the resolver excludes its own cross-scope columns.
 * (Seam B.)
 */
export type ReferenceResolver = {
  /**
   * Read-time render pick: stored reference value → the ONE rootId it renders
   * as (omit a key to leave it unresolved). Identity default: `value → value`.
   */
  resolveRenderTargets(
    db: DrizzleInstance,
    scopeColumns: Record<string, unknown> | undefined,
    collection: string,
    storedValues: string[],
  ): Promise<Map<string, string>>;

  /**
   * Conflict superset: stored reference keys → ALL rootIds they could render as
   * (a group key expands to its whole group). Used by the A/B co-render walk;
   * collection-agnostic (a reference may target any collection). Identity
   * default: the existing, non-archived roots among `storedKeys` (by id).
   */
  resolveConflictTargets(
    db: DrizzleInstance,
    scopeColumns: Record<string, unknown> | undefined,
    storedKeys: string[],
  ): Promise<string[]>;

  /** rootIds → all their group siblings. Identity default: the input rootIds. */
  expandGroup(
    db: DrizzleInstance,
    scopeColumns: Record<string, unknown> | undefined,
    rootIds: string[],
  ): Promise<string[]>;

  /** rootIds → the group keys a host could embed them by. Default: `[]`. */
  groupKeysFor(
    db: DrizzleInstance,
    scopeColumns: Record<string, unknown> | undefined,
    rootIds: string[],
  ): Promise<string[]>;
};

/**
 * Plugin-provided variable resolution (i18n). Loads the variable map for the
 * active language WITH fallback: for each key, the value from the highest-priority
 * language in `[active, ...fallback]` that has a row. `scopeColumns` carries the
 * cross-scope tenant predicate (language is resolved by the chain, NOT filtered).
 * When absent, core loads variables directly (optionally tenant-filtered). The
 * read paths ride this off the resolved scope. (Seam B, variables.)
 */
export type VariableResolver = {
  load(
    db: DrizzleInstance,
    scopeColumns: Record<string, unknown> | undefined,
  ): Promise<Map<string, string>>;
};

/** One variant branch of a running A/B test on a referenced root. */
export type RunningAbTestVariant = {
  branchId: string;
  isControl: boolean;
};

/** A running A/B test on one root: the test plus its variant branches. */
export type RunningAbTest = {
  testId: string;
  trafficPercentage: number;
  variants: RunningAbTestVariant[];
};

/**
 * A plugin-provided resolver that reports which referenced roots currently have
 * a RUNNING A/B test (with that test's variant branches). Carried on the
 * resolved scope and consumed by the read path's reference loader to fan the one
 * XOR-guaranteed varying block's branches out to the client (AB_FANOUT F2). Core
 * ships NO default — when absent (no ab-test plugin) the read path assumes no
 * running tests and every embed stays on its deterministic single pick (F0).
 * Core never names any A/B concept beyond this interface. (Seam F.)
 */
export type AbTestResolver = {
  /**
   * The subset of `rootIds` that have a running test, each mapped to its test +
   * variant branches. `db` AND `scopeColumns` are passed PER CALL (same
   * rationale as {@link ReferenceResolver}). The caller passes already
   * render-resolved (active-language) rootIds, so this needs no group expansion.
   */
  runningTests(
    db: DrizzleInstance,
    scopeColumns: Record<string, unknown> | undefined,
    rootIds: string[],
  ): Promise<Map<string, RunningAbTest>>;
};

export type ResolvedScope = {
  roots?: RootTableScope;
  assets?: TableScope;
  assetFolders?: TableScope;
  redirects?: TableScope;
  templates?: TableScope;
  variables?: TableScope;
  /**
   * Plugin-provided reference resolver (i18n translation-group resolution). When
   * absent, callers use core's identity default. Generic — see `ReferenceResolver`.
   */
  referenceResolver?: ReferenceResolver;
  /**
   * Plugin-provided variable resolver (i18n active-language-with-fallback). When
   * absent, core loads variables directly. Generic — see {@link VariableResolver}.
   */
  variableResolver?: VariableResolver;
  /**
   * Plugin-provided running-A/B-test resolver (AB_FANOUT F2 server fan-out).
   * When absent, the read path assumes no running tests. Generic — see
   * {@link AbTestResolver}.
   */
  abTestResolver?: AbTestResolver;
  /**
   * Opaque per-plugin context slots, keyed by plugin id. Core never reads it;
   * each plugin stashes its own per-request context here from a scope factory
   * and reads it back via its own exported accessor. Merged generically in
   * computeScope (shallow, last-writer-wins per slot).
   */
  pluginContext?: Record<string, unknown>;
};

/**
 * Factory registered by plugins during `init`.
 * Called once per request with the middleware result to produce
 * table-level WHERE conditions and extra INSERT values.
 */
export type ScopeConditionFactory = (
  mwResult: MiddlewareResult,
) => ResolvedScope;

// ============================================================================
// Utility Types
// ============================================================================

export type CMSOperation = 'read' | 'create' | 'update' | 'delete';

// ============================================================================
// Block Property Types
// ============================================================================

type BlockTypes = {
  string: string;
  number: number;
  boolean: boolean;
  date: string;
  richText: string;
  image: string;
  select: string;
  // The AUTHORED value of a reference is the target's rootId STRING. It is
  // inlined to a `ResolvedReference` only on the published read path (the
  // `resolved` inference mode); write input + the editor read keep the string.
  reference: string;
};

/** Reference inference mode: `raw` (write input + getBlockTree editor read) keeps
 *  a `reference` as its stored rootId string; `resolved` (getPublishedContent)
 *  surfaces the inlined `ResolvedReference`. */
type RefMode = 'raw' | 'resolved';

export type BlockPropertyType = keyof BlockTypes;

// ============================================================================
// Blocks
// ============================================================================

export type SelectOption = { readonly label: string; readonly value: string };

type BlockPropertySpec<T extends BlockPropertyType> = {
  type: T;
  required?: boolean;
  defaultValue?: BlockTypes[T];

  label: string;
  description?: string;
  placeholder?: string;
  /**
   * Editor hint: the field-group (fieldset/section) this property is shown under
   * in the property panel (e.g. `'SEO'`, `'Layout'`). Purely presentational —
   * the editor groups fields by this label; the package never acts on it.
   * Free-form by design; for consistent, autocompleted group names across
   * fields, reference a shared `as const` object (e.g. `group: FIELD_GROUPS.seo`).
   */
  group?: string;
} & (T extends 'select' ? { options: readonly SelectOption[] } : {}) &
  (T extends 'reference' ? { collection: string } : {});

/** Discriminated union over all concrete block-property specs. */
export type BlockProperty = {
  [K in BlockPropertyType]: BlockPropertySpec<K>;
}[BlockPropertyType];

type Simplify<T> = { [K in keyof T]: T[K] };

/** Extracts the runtime value type for a block property.
 *  For `select` properties with options, returns the union of option values.
 *  A `reference` is a rootId string in `raw` mode (write input + editor read) and
 *  a `ResolvedReference` in `resolved` mode (published read).
 *  For all other types, returns the corresponding primitive type. */
type InferPropertyValue<
  T extends BlockProperty,
  M extends RefMode = 'raw',
  TCol extends Record<string, AnyCollectionDefinition> = {},
> = T extends {
  type: 'select';
  options: readonly { readonly value: infer V extends string }[];
}
  ? V
  : T extends { type: 'reference'; collection: infer C extends string }
    ? M extends 'resolved'
      ? // Resolved read: a reference is the inlined target. When the target
        // collection is in the threaded map, its `properties` are typed from the
        // target's root definition. Nested references inside the target stay
        // UNTYPED (the inner InferBlockProperties defaults TCol to `{}`), which
        // bounds resolution to depth 1 and avoids cyclic-reference type blowup.
        C extends keyof TCol
        ? ResolvedReference<
            NonNullable<
              InferBlockProperties<TCol[C]['root']['properties'], 'resolved'>
            >
          >
        : ResolvedReference
      : string
    : BlockTypes[T['type']];

type RequiredPart<
  T extends Record<string, BlockProperty>,
  M extends RefMode,
  TCol extends Record<string, AnyCollectionDefinition>,
> = {
  [K in keyof T as T[K] extends { required: true }
    ? K
    : never]: InferPropertyValue<T[K], M, TCol>;
};

type OptionalPart<
  T extends Record<string, BlockProperty>,
  M extends RefMode,
  TCol extends Record<string, AnyCollectionDefinition>,
> = {
  [K in keyof T as T[K] extends { required: true }
    ? never
    : K]?: InferPropertyValue<T[K], M, TCol>;
};

type HasRequiredKeys<T extends Record<string, BlockProperty>> = true extends {
  [K in keyof T]: T[K] extends { required: true } ? true : never;
}[keyof T]
  ? true
  : false;

/** Maps a properties record to its runtime value types, respecting `required`.
 *  When all properties are optional, the entire input becomes optional (| undefined). */
export type InferBlockProperties<
  T extends Record<string, BlockProperty>,
  M extends RefMode = 'raw',
  TCol extends Record<string, AnyCollectionDefinition> = {},
> =
  HasRequiredKeys<T> extends true
    ? Simplify<RequiredPart<T, M, TCol> & OptionalPart<T, M, TCol>>
    : Simplify<RequiredPart<T, M, TCol> & OptionalPart<T, M, TCol>> | undefined;

// ============================================================================
// Event declarations (functional blocks declare the events they emit)
// ============================================================================

/** Scalar property subset usable as an event parameter (no references/media). */
export type ScalarBlockProperty = Extract<
  BlockProperty,
  { type: 'string' | 'number' | 'boolean' | 'select' | 'date' }
>;

/**
 * Declares a meaningful event a functional block can emit (e.g. a form's
 * `submitSuccess`). Living on the block DEFINITION makes it the single source of
 * truth for the typed `fire(...)` union, the test-creation goal picker, and the
 * analytics wire name. `name` overrides the GA4/dataLayer wire name (defaults to
 * `cms_<blockType>_<eventKey>`, computed by the measurement layer). Whether an
 * event counts as a conversion is decided per test in the UI, not here.
 */
export type EventDeclaration = {
  /** Analytics wire-name override (snake_case). Defaults to cms_<type>_<key>. */
  name?: string;
  /** Typed parameters carried with the event (scalar only). */
  params?: Record<string, ScalarBlockProperty>;
  /** Human label for the goal picker. */
  label?: string;
};

/** Parameters object type for one event declaration (or `undefined` if none). */
export type InferEventParams<E extends EventDeclaration> = E extends {
  params: infer P extends Record<string, BlockProperty>;
}
  ? InferBlockProperties<P>
  : undefined;

/** Call-args tuple for `fire`: required iff the event declares a required param. */
type EventFireArgs<E extends EventDeclaration> = E extends {
  params: infer P extends Record<string, BlockProperty>;
}
  ? HasRequiredKeys<P> extends true
    ? [params: InferBlockProperties<P>]
    : [params?: InferBlockProperties<P>]
  : [];

/** Event keys a block declares. */
export type BlockEventNames<TEvents extends Record<string, EventDeclaration>> =
  keyof TEvents & string;

/**
 * The typed `fire` signature derived from a block's event declarations — the
 * runtime tracker (M3) implements this. `fire('unknown')`, a missing required
 * param, and a wrong-typed param are all compile errors.
 */
export type BlockEventFire<TEvents extends Record<string, EventDeclaration>> = <
  K extends BlockEventNames<TEvents>,
>(
  name: K,
  ...args: EventFireArgs<TEvents[K]>
) => void;

/**
 * Compile-time requirement: a block that declares `events` (a functional block)
 * MUST carry a `trackingId` string property — the stable, per-instance,
 * cross-branch goal anchor. Intersected into `defineBlock`'s parameter so a
 * functional block missing it fails to compile. Spread `...trackingId()` into
 * `properties` to satisfy it. (The property is optional at create; the VALUE is
 * enforced at publish by the tracking-id guard.)
 */
export type RequireTrackingId<
  TProps extends Record<string, BlockProperty>,
  TEvents extends Record<string, EventDeclaration>,
> = [keyof TEvents] extends [never]
  ? unknown // no events at all (empty)
  : string extends keyof TEvents
    ? unknown // the `Record<string, never>` default (index signature) = no events
    : TProps extends { trackingId: { type: 'string' } }
      ? unknown
      : {
          __error_missing_trackingId: "A block that declares `events` must include a `trackingId` property of type 'string' — spread `...trackingId()` into `properties`.";
        };

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
   * `'Forms'`, `'Layout'`). Purely presentational — the editor groups blocks by
   * this label; the package never acts on it. Free-form by design; for
   * consistent, autocompleted group names across blocks, reference a shared
   * `as const` object (e.g. `group: BLOCK_GROUPS.forms`).
   */
  group?: string;
  /** Events this (functional) block can emit — see {@link EventDeclaration}. */
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

/** createBlock input — routing fields at top level, discriminated block union nested.
 *  Nesting avoids oRPC's Schema brand breaking discriminated-union autocomplete. */
export type InferCreateBlockInput<
  TBlocks extends Record<string, AnyBlockDefinition>,
> = {
  rootId: string;
  branchId: string;
  parentBlockId: string;
  position?: number;
  message?: string;
} & InferBlockInput<TBlocks>;

/** createMergeBlockVersion input — discriminated union of all block types
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

/** Partial properties variant for updates (PATCH semantics): every key is
 *  optional; setting a key to a value overwrites it, setting it to `null`
 *  deletes it, and omitting it leaves it unchanged. */
export type InferPartialBlockProperties<
  T extends Record<string, BlockProperty>,
> = Simplify<{ [K in keyof T]?: InferPropertyValue<T[K]> | null }>;

/** updateBlock input — identifies the block and provides a partial properties object.
 *  Only supplied fields are merged; omitted fields keep their current values.
 *  When TRootProps is provided, a `type: 'root'` variant is included for
 *  updating the root block's properties. */
export type InferUpdateBlockInput<
  TBlocks extends Record<string, AnyBlockDefinition>,
  TRootProps extends Record<string, BlockProperty> = never,
> = {
  rootId: string;
  branchId: string;
  blockId: string;
  message?: string;
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

/** A single row returned by `listRoots`, typed by the root properties. */
export type RootListItem<TRootProps extends Record<string, BlockProperty>> = {
  rootId: string;
  createdAt: Date;
  createdBy?: string;
  parentRootId?: string;
  slug?: string;
  /**
   * The full, ancestor-resolved URL path (e.g. `/blog/post`), with the
   * collection's slug-config root prefix applied. Present for slug-enabled
   * collections; `slug` alone is only the last segment.
   */
  path?: string;
  sortOrder: number;
  properties: NonNullable<InferBlockProperties<TRootProps>>;
  hasPublications: boolean;
  publicationCount: number;
  branchCount: number;
  openMergeRequestCount: number;
  /** Present only when called with `query.withUser`. Shape depends on the
   *  configured user table; left as `unknown` until cross-table inference. */
  createdByUser?: unknown;
};

/** Result of `listRoots`, typed by the collection's root properties. */
export type ListRootsResult<TRootProps extends Record<string, BlockProperty>> =
  {
    roots: RootListItem<TRootProps>[];
    total: number;
    hasMore: boolean;
  };

/** Root summary attached to list responses via the `withRoot` query flag
 *  (e.g. `listMergeRequests`). `properties` is typed from the root definition. */
export type RootSummary<TRootProps extends Record<string, BlockProperty>> = {
  rootId: string;
  slug: string | null;
  parentRootId: string | null;
  sortOrder: number;
  properties: NonNullable<InferBlockProperties<TRootProps>>;
  hasPublications: boolean;
};

/** A single row from `listMergeRequests`. `root`/`createdByUser` are present
 *  only when requested via the `withRoot`/`withUser` query flags. */
export type MergeRequestListItem<
  TRootProps extends Record<string, BlockProperty>,
> = {
  id: string;
  rootId: string;
  sourceBranchId: string;
  sourceBranchName: string;
  targetBranchId: string;
  targetBranchName: string;
  sourceCommitId: string;
  baseCommitId: string | null;
  mergeCommitId: string | null;
  status: 'open' | 'merged' | 'closed';
  title: string | null;
  description: string | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  conflictCount: number;
  hasConflicts: boolean;
  commentCount: number;
  createdByUser?: unknown;
  root?: RootSummary<TRootProps> | null;
};

/** Result of `listMergeRequests`, typed by the collection's root properties. */
export type ListMergeRequestsResult<
  TRootProps extends Record<string, BlockProperty>,
> = {
  mergeRequests: MergeRequestListItem<TRootProps>[];
  total: number;
  hasMore: boolean;
};

/** A single row from `listBranches`. Branches carry no block properties.
 *  `createdByUser` is present only when requested via the `withUser` flag. */
export type BranchListItem = {
  id: string;
  rootId: string;
  name: string;
  headCommitId: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  isDeletable: boolean;
  /** Whether this branch is currently published (has a `publications` row). */
  hasPublications: boolean;
  createdByUser?: unknown;
};

/** Result of `listBranches`. */
export type ListBranchesResult = {
  branches: BranchListItem[];
  total: number;
  hasMore: boolean;
};

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

type SlugConfig =
  | { enabled: false }
  | {
      enabled: true;
      root: string;
      allowRoot?: boolean;
      normalize?: boolean;
      nested?: boolean;
    };

export type ResolvedSlugConfig =
  | { enabled: false }
  | {
      enabled: true;
      root: string;
      allowRoot: boolean;
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

// ============================================================================
// CMS
// ============================================================================

export type DataRetentionConfig = {
  keepDays: number;
  keepMinCommits: number;
  /**
   * Grace period (days) before a soft-archived root (`archivedAt`) is physically
   * hard-deleted by pruning. Defaults to `keepDays` when omitted — a trash
   * window after which the page and its whole history are reclaimed.
   */
  archiveKeepDays?: number;
};

// ============================================================================
// User Middleware Types
// ============================================================================

/**
 * Subset of the incoming request forwarded to the authMiddleware.
 * Available for all call styles (HTTP router and direct server-side calls).
 */
export type CMSMiddlewareRequest = {
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  headers?: HeadersInit;
  request?: Request;
};

type CMSCollectionScopeContext = {
  scope: 'collection';
  collection: CollectionWithName;
};

type CMSSystemScopeContext = {
  scope: 'system';
  collection?: never;
};

/** Ctx available to user-defined middleware */
export type CMSMiddlewareCtx = CMSProcedureCtx &
  (CMSCollectionScopeContext | CMSSystemScopeContext) & {
    permissionResource: string;
    operation: CMSOperation;
    branchName?: string;
    request?: CMSMiddlewareRequest;
  };

/** Result that user middleware can return to extend context */
export type MiddlewareResult = {
  userId?: string;
  [key: string]: unknown;
};

/** User-defined middleware function type */
export type CMSMiddleware = (
  ctx: CMSMiddlewareCtx,
) => Promise<MiddlewareResult> | MiddlewareResult;

// ============================================================================
// Revalidation
// ============================================================================

export type RevalidateEvent<
  TCollections extends Record<string, AnyCollectionDefinition> = Record<
    string,
    AnyCollectionDefinition
  >,
> = {
  action: CMSHookAction;
  collection: keyof TCollections & string;
  rootId: string;
  branchId: string;
  slug: string | null;
  paths: string[];
  /**
   * Next.js cache tags to revalidate alongside `paths` (AB_FANOUT FA3b). Always
   * includes the affected root's tag (`rootRevalidateTag(rootId)`); the A/B
   * variant-coded render routes tag their getPublishedContent fetch with it, so
   * one `revalidateTag` invalidates a root's control + every variant cache entry
   * (and, via cascade, its hosts) on a content change. Consumed by
   * `createRevalidateHandler`.
   */
  tags?: string[];
};

export type RevalidateHandler<
  TCollections extends Record<string, AnyCollectionDefinition> = Record<
    string,
    AnyCollectionDefinition
  >,
> = (event: RevalidateEvent<TCollections>) => Promise<void> | void;

export type RevalidateConfig<
  TCollections extends Record<string, AnyCollectionDefinition> = Record<
    string,
    AnyCollectionDefinition
  >,
> = {
  handler: RevalidateHandler<TCollections>;
  pathPatterns?: {
    [K in keyof TCollections & string]?: (slug: string) => string[];
  };
  debug?: boolean;
};

// ============================================================================
// CMS Definition
// ============================================================================

export type CMSSchemaConfig = {
  output?: string;
};

// ============================================================================
// User Relation Config
// ============================================================================

export type CMSUserConfig<TTable extends AnyPgTable = AnyPgTable> = {
  table: TTable;
  idColumn: AnyColumn;
  /**
   * Allowlist of user-table columns that may ever be returned via the
   * `withUser` query flag. This is a hard security boundary: any column not
   * listed here is never exposed — not even when explicitly requested.
   * Required so that adding a sensitive column to the user table (password
   * hashes, tokens, internal flags) can never leak by default.
   */
  exposeColumns: (keyof TTable['$inferSelect'] & string)[];
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
   * Minimum distinct approved reviewers required by the merge / publish gates,
   * on top of "all requested reviewers approved". Default `1`.
   */
  requiredReviewers?: number;
};

/**
 * How `executeMerge` integrates a source branch when a fast-forward IS possible
 * (the target has not diverged from the common ancestor):
 * - `'fast-forward'` (default) — move the target head to the source head; no
 *   merge commit. The leanest history.
 * - `'merge-commit'` — always record an explicit merge commit (git's `--no-ff`),
 *   so every integration is visible in history.
 *
 * When the target HAS diverged a merge commit is always created regardless.
 */
export type MergeStrategy = 'fast-forward' | 'merge-commit';

export type CMSDefinition<
  TCollections extends Record<string, AnyCollectionDefinition> = Record<
    string,
    AnyCollectionDefinition
  >,
  TPlugins extends CMSPlugin[] = CMSPlugin[],
> = {
  db: DrizzleInstance;
  media: MediaConfig;
  collections: TCollections;
  dataRetention?: DataRetentionConfig;
  /**
   * When `true`, every content-mutating operation (createRoot / createBlock /
   * updateBlock / deleteBlock / moveBlock / duplicateBlock / updateBlocks /
   * updateRoot) requires a non-empty `message` — an empty or whitespace-only
   * message is rejected with `COMMIT_MESSAGE_REQUIRED` instead of falling back
   * to an auto-generated default. Off by default.
   */
  forceCommitMessage?: boolean;
  /** Name of the default branch every root is seeded with. Default `'main'`. */
  defaultBranchName?: string;
  /** Branch-protection and approval gates — see {@link BranchProtectionConfig}. */
  branchProtection?: BranchProtectionConfig;
  /**
   * Default integration strategy for `executeMerge` when a fast-forward is
   * possible. `'fast-forward'` (default) or `'merge-commit'` (always record a
   * merge commit). Override per call with `executeMerge({ noFastForward })`.
   * See {@link MergeStrategy}.
   */
  mergeStrategy?: MergeStrategy;
  authMiddleware?: CMSMiddleware;
  middleware?: CMSMiddleware;
  basePath?: string;
  hooks?: CMSHooks;
  plugins?: TPlugins;
  schema?: CMSSchemaConfig;
  user?: CMSUserConfig;
  onRevalidate?:
    | RevalidateHandler<TCollections>
    | RevalidateConfig<TCollections>;
  onNotification?: OnNotificationHandler;
};

// CMSInstance is not explicitly typed -- createCMS return type is inferred by TypeScript.
// Use `typeof cms` or `ReturnType<typeof createCMS<...>>` for the instance type.

// ============================================================================
// Procedure Context Types
// ============================================================================

/** Base ctx injected by withCMSContext middleware. */
export type CMSProcedureCtx = {
  db: DrizzleInstance;
  collections: Record<string, CollectionWithName>;
  dataRetention?: DataRetentionConfig;
  /** When `true`, commit-producing routes reject an empty `message`. */
  forceCommitMessage?: boolean;
  /** Name of the default branch (resolved; see {@link CMSDefinition.defaultBranchName}). */
  defaultBranchName?: string;
  /** Branch-protection and approval gates — see {@link BranchProtectionConfig}. */
  branchProtection?: BranchProtectionConfig;
  /** Default merge integration strategy — see {@link CMSDefinition.mergeStrategy}. */
  mergeStrategy?: MergeStrategy;
  scopeConditions?: ScopeConditionFactory[];
  notificationService?: import('../notifications/service').NotificationService;
  resolvedUser?: ResolvedUserConfig;
};

/**
 * Full ctx available in collection-scoped route handlers.
 * Built up through the middleware chain:
 *   withCMSContext → withCollection → withAction → withUserMiddleware
 */
export type CMSHandlerCtx<
  TExtensions extends Record<string, unknown> = Record<string, unknown>,
> = CMSProcedureCtx & {
  scope: 'collection';
  collection: CollectionWithName;
  permissionResource: string;
  operation: CMSOperation;
} & TExtensions;

export type CMSSystemHandlerCtx<
  TExtensions extends Record<string, unknown> = Record<string, unknown>,
> = CMSProcedureCtx & {
  scope: 'system';
  permissionResource: string;
  operation: CMSOperation;
} & TExtensions;

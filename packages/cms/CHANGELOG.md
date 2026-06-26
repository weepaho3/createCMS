# @createcms/core

## 0.2.4

### Patch Changes

- [#11](https://github.com/weepaho3/createCMS/pull/11) [`bd91957`](https://github.com/weepaho3/createCMS/commit/bd91957a052f275b5e3ea41394e3be3744b3e2be) Thanks [@weepaho3](https://github.com/weepaho3)! - Fix a client/server path mismatch that made the `variables`, `templates`, and `search` namespaces unreachable from the client.

  The client proxy builds every request URL as `/<namespace>/<method>` (e.g. `client.variables.listVariables()` → `/variables/listVariables`), but these endpoints were mounted at hand-written paths that didn't follow that convention (`/variables`, `/variables/get`, `/templates/create`, `/search`, …). Every such call 404'd. Handler-level tests didn't catch it because `cms.api.<ns>.<method>()` invokes the handler directly and never exercises HTTP routing.

  - All `variables` endpoints now mount at `/variables/<method>` (e.g. `/variables/listVariables`, `/variables/getVariable`).
  - All `templates` endpoints now mount at `/templates/<method>` (e.g. `/templates/listTemplates`, `/templates/getTemplate`).
  - `search` now mounts at `/search/search` (matching `client.search.search()`).

  A new test asserts every RPC endpoint is mounted at exactly `/<namespace>/<method>`, so this class of drift can't regress. (Direct-URL routes with a path parameter, like the public `/media/asset/{assetSlug}` redirect, are intentionally exempt.)

- [#11](https://github.com/weepaho3/createCMS/pull/11) [`ff516e9`](https://github.com/weepaho3/createCMS/commit/ff516e97e8a96dd3420dec708ada8dce49c505e5) Thanks [@weepaho3](https://github.com/weepaho3)! - Add a configurable merge strategy for `executeMerge`.

  - **`mergeStrategy`** (CMS config) — `'fast-forward'` (default) or `'merge-commit'`. Controls how `executeMerge` integrates when a fast-forward is possible (the target has not diverged). `'merge-commit'` always records an explicit merge commit (git's `--no-ff`) so every integration is visible in history. A diverged target always produces a merge commit regardless.
  - **`executeMerge({ noFastForward })`** — per-call override of the configured strategy. `true` forces a merge commit, `false` forces a fast-forward.

  A merge with nothing to integrate (the source and target heads are already equal) stays a no-op fast-forward even under `noFastForward`/`'merge-commit'`, so no empty merge commit is fabricated. Default behavior is unchanged (`'fast-forward'`).

- Replace `branchProtection.protectMain` with `branchProtection.protectPublishedBranches`.

  **Breaking:** `protectMain` (shipped in 0.2.3) is removed. It protected the default branch by name; the replacement instead locks a branch against direct content mutations for exactly as long as it is **published** — published content is the live, production-facing tree, so it is made immutable in place. Changes go via another branch + merge, then a re-publish; unpublishing makes the branch directly editable again. This applies to **any** published branch (a root can have several at once, e.g. A/B variants), not just the default one, and a never-published branch is freely editable.

  - Enforced by a shared `assertBranchWritable` guard on every content-mutation route, including `revertBranch` (which rewrites a published branch's head in place).
  - `createRoot` is never gated (it seeds a fresh, unpublished branch).
  - Still throws `PROTECTED_BRANCH` (403).

  Migration: rename `protectMain: true` to `protectPublishedBranches: true`. Note the new semantics — protection now follows the publication state, not the branch name.

## 0.2.3

### Patch Changes

- [#9](https://github.com/weepaho3/createCMS/pull/9) [`be8c643`](https://github.com/weepaho3/createCMS/commit/be8c64337574fc780bf9714fe2acc8ab2402dbd0) Thanks [@weepaho3](https://github.com/weepaho3)! - Add branch-protection and approval governance to the CMS config, plus a configurable default branch name.

  - **`branchProtection.protectMain`** — reject direct content mutations on the default branch (create/update/delete/move/duplicate of blocks, and `updateRoot`); edits must go via a branch + merge. `createRoot` is exempt. Throws the new `PROTECTED_BRANCH` (403) error.
  - **`branchProtection.requireApprovalBeforePublish`** — make `publishBranch` always require approvals, not just when one was explicitly requested. Default `false` (existing conditional behavior).
  - **`branchProtection.requiredReviewers`** — minimum distinct approved reviewers for the merge / publish gates (default `1`).
  - **`defaultBranchName`** — the branch every root is seeded with, replacing the hard-coded `'main'` throughout (rename/delete guards, read/search resolution, and i18n translation copy-seeding).

  **Breaking:** `branchProtection.requireApprovalToMerge` defaults to `false`. Previously `executeMerge` ALWAYS required approvals; merges now succeed without approval unless you set `requireApprovalToMerge: true`. Set it explicitly to keep the prior gate.

- [#9](https://github.com/weepaho3/createCMS/pull/9) [`1d9bf1f`](https://github.com/weepaho3/createCMS/commit/1d9bf1fcf211112ad707c661a72a3d85333627c9) Thanks [@weepaho3](https://github.com/weepaho3)! - Add a `forceCommitMessage` option to the CMS config. When `true`, every content mutation (createRoot / createBlock / updateBlock / deleteBlock / moveBlock / duplicateBlock / updateBlocks / updateRoot) requires a non-empty `message` — an empty or whitespace-only message is rejected with the new `COMMIT_MESSAGE_REQUIRED` error instead of falling back to an auto-generated default. Off by default, so existing behavior is unchanged.

- [#9](https://github.com/weepaho3/createCMS/pull/9) [`a45021a`](https://github.com/weepaho3/createCMS/commit/a45021a28245d0063e8e2c0aa9fc5bd6ffd17411) Thanks [@weepaho3](https://github.com/weepaho3)! - `getRootHistory` now attributes each commit to the branch it was **created on**, deterministically — fixing wrong branch labels for shared ancestors.

  Previously the branch label was inferred with a recursive "nearest branch tip wins (`MIN(depth)`)" heuristic, which mis-attributed commits that lie on more than one branch's first-parent chain (a feature branch with fewer post-fork commits could "claim" main's shared history). The originating branch is now stored on each commit and read directly.

  - `commits` gains `branchId` (links to the live branch — follows renames; no FK) and `originBranchName` (a deletion-proof name snapshot). Both are set at commit-write time.
  - `getRootHistory` resolves `branch = COALESCE(live branch name, originBranchName)` via a simple join — the recursive CTE is gone (O(n), deterministic).

  **Schema change, no backfill (beta):** the new `origin_branch_name` column is `NOT NULL`; recreate the database. There is no migration of existing commit rows.

## 0.2.2

### Patch Changes

- [#7](https://github.com/weepaho3/createCMS/pull/7) [`1cc595f`](https://github.com/weepaho3/createCMS/commit/1cc595fb6f6c6702322eb7425efa1a36c1b77788) Thanks [@weepaho3](https://github.com/weepaho3)! - Fix `createTrackedBlocks(...).useTrackedBlock('myBlock')` rejecting a block that declared `events` when the collection is used in its declared form (e.g. `typeof myCollection`). `events` is optional on `BlockDefinition`, so the `FunctionalBlocks` key-filter saw `TEvents | undefined` and filtered out every block (`(X | undefined) extends Record<…>` is false). The key-filter now `NonNullable`s the `events` access, matching the value side — functional blocks are detected again and `fire` stays narrowed.

- [#7](https://github.com/weepaho3/createCMS/pull/7) [`9009209`](https://github.com/weepaho3/createCMS/commit/9009209774ee3f0861b15ba4e5983754b99a75f2) Thanks [@weepaho3](https://github.com/weepaho3)! - Add an optional `group` string to block property definitions — an editor hint for the field-group (fieldset/section) a field is shown under in the property panel (e.g. `group: 'SEO'`). Presentational only; free-form, use a shared `as const` for consistent, autocompleted group names. Mirrors the block-level `group`.

## 0.2.1

### Patch Changes

- [#5](https://github.com/weepaho3/createCMS/pull/5) [`d9f6988`](https://github.com/weepaho3/createCMS/commit/d9f6988dadc930c51ebdda9bd611ce2ea4857e69) Thanks [@weepaho3](https://github.com/weepaho3)! - Add an optional `group` string to block definitions — an editor hint for the block-picker category a block appears under (e.g. `group: 'Forms'`). Presentational only; the package does not act on it. Free-form by design; reference a shared `as const` object for consistent, autocompleted group names across blocks.

- [#5](https://github.com/weepaho3/createCMS/pull/5) [`ff46dc7`](https://github.com/weepaho3/createCMS/commit/ff46dc72107b7dd2f270456e348a61c747e16edf) Thanks [@weepaho3](https://github.com/weepaho3)! - Fix `BlockProps<typeof collection, 'blockType'>` failing to compile. The helper required a non-optional `blocks` field, but `blocks` is optional on `CollectionDefinition`, so passing a collection definition errored with "Type 'undefined' is not assignable to type 'Record<string, AnyBlockDefinition>'". The constraint now accepts the optional shape and resolves it via `NonNullable`, so `BlockProps<typeof myCollection, 'myBlock'>` works and the block name still autocompletes.

- [#5](https://github.com/weepaho3/createCMS/pull/5) [`060e6ae`](https://github.com/weepaho3/createCMS/commit/060e6ae16719d030f8f8e92cd432571d83b17ffa) Thanks [@weepaho3](https://github.com/weepaho3)! - `createBlocksMap` now bundles the collection definition on the returned `BlocksMap` (a typed `_collection`), so a single object can drive both rendering and an editor — components, events, and the collection's schema/placement/grouping in one handoff, with no separate `collection` prop. `BlocksMap` gained an optional type parameter that defaults to the erased collection type, so existing `BlocksMap` annotations and `BlocksRenderer` are unaffected.

## 0.2.0

### Minor Changes

- [#3](https://github.com/weepaho3/createCMS/pull/3) [`f263c1f`](https://github.com/weepaho3/createCMS/commit/f263c1fe36349bb35337ddfc158245acb5a946cd) Thanks [@weepaho3](https://github.com/weepaho3)! - Block placement constraints. Collections now take a `structure` map that controls which blocks may be nested where, replacing the removed `allowedChildBlocks` field.

  - `structure` is keyed by parent block name (or the literal `'root'`) with three mutually exclusive modes per entry: open (`{}` / `{ accepts: '*' }`), whitelist (`{ accepts: ['x'] }`, fail-closed), or blacklist (`{ excludes: ['x'] }`, fail-open). A concrete `accepts` list together with `excludes` is a compile error. Block names autocomplete against the collection's blocks and typos are caught at compile time.
  - `allowChildren` is now enforced on the server: a non-container block (without `allowChildren: true`) rejects all children. The root always accepts children.
  - `createBlock`, `moveBlock`, and `duplicateBlock` enforce these rules and throw the new `BLOCK_NOT_ALLOWED_IN_PARENT` error; the visual editor reads the same rules for drop-zone gating, so the two can't diverge.

  **Breaking:** `allowedChildBlocks` is removed — express the same intent with `structure` (e.g. `structure: { section: { accepts: ['featureItem'] } }`). Blocks that hold children must now declare `allowChildren: true`.

## 0.1.1

### Patch Changes

- [`028d2f2`](https://github.com/weepaho3/createCMS/commit/028d2f2e98f916a965b643c4ce23c8f33622679a) Thanks [@weepaho3](https://github.com/weepaho3)! - Fix `createcms generate` failing on configs that use the idiomatic
  `defineCollection` / `defineCollections` / `defineAuthMiddleware` API. The
  config-loading shim now stubs these helpers (they are pure identity functions at
  runtime), so a config written exactly as the docs show loads correctly during
  schema generation.

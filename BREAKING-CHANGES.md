# Breaking changes

Every consumer-visible break in `@createcms/core`, newest release first, with the
migration for each one. This is the single place that answers **"what broke since
version X?"** without reading diffs.

The complete release notes (features, fixes, internals) live in the
[changelog](./packages/cms/CHANGELOG.md). This file carries **only** the breaks.

createCMS is pre-1.0, so **minor is the breaking channel** — see
[Versioning](./CONTRIBUTING.md#versioning). Breaking changes are applied cleanly:
no compat shims, no aliases. Pin an exact version.

> **How the pre-0.7 entries were produced.** They were reconstructed by hand from
> the released changesets and diffs of each tag, because no commit in the history
> up to 0.6.0 carried a marker — `git log --pretty=%s | grep -c '!'` and
> `git log --pretty=%B | grep -c "BREAKING CHANGE"` both returned `0` across all
> 223 commits. From now on every break is marked at commit time
> ([Commit conventions](./CONTRIBUTING.md#commit-conventions)) and appended here in
> the same PR that ships it, so this file is maintained forward rather than
> re-derived. The reconstructed sections are complete with respect to the shipped
> changesets; a break that was never written down in a changeset would not appear
> here.

## At a glance

| Release    | Date       | Breaking changes                                                                                                                                                       | Database action                             |
| ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **0.6.0**  | 2026-08-14 | none (merge behaviour changed — see notes)                                                                                                                             | —                                           |
| **0.5.0**  | 2026-08-03 | client type surface: `uploadAssets` / `replaceAsset` hidden; upload error `cause` dropped                                                                              | —                                           |
| **0.4.0**  | 2026-08-02 | **ESM-only + Node ≥ 22.12**, Next ≥ 16.2.11, `duplicateBlock`, `publishRelease` permission, `listMentions`, `ApprovalOutput.branchId`, stricter block-write validation | **regenerate + migrate**                    |
| **0.3.0**  | 2026-07-11 | `getDiff` response shape + `moved` semantics, `duplicateRoot` permission resource                                                                                      | —                                           |
| **0.2.12** | 2026-07-09 | the large one — required auth, ~30 renames, uniform return shapes, versioned slug, stricter validation                                                                 | **regenerate + migrate**                    |
| 0.2.11     | 2026-06-29 | none                                                                                                                                                                   | —                                           |
| 0.2.10     | 2026-06-29 | none                                                                                                                                                                   | —                                           |
| **0.2.9**  | 2026-06-29 | media gate re-addressed by asset **id**; the 0.2.8 image read shape reverted                                                                                           | —                                           |
| **0.2.8**  | 2026-06-28 | `image` properties resolve to `{ id, slug }` on read (reverted in 0.2.9)                                                                                               | —                                           |
| **0.2.7**  | 2026-06-28 | `getAssetUrlAuthenticated` removed                                                                                                                                     | —                                           |
| **0.2.6**  | 2026-06-26 | —                                                                                                                                                                      | **recreate** (enum value, no backfill)      |
| **0.2.5**  | 2026-06-26 | `createTemplate` rejects non-text target properties                                                                                                                    | **recreate** (index + columns, no backfill) |
| **0.2.4**  | 2026-06-26 | `branchProtection.protectMain` → `protectPublishedBranches` (new semantics)                                                                                            | —                                           |
| **0.2.3**  | 2026-06-25 | `requireApprovalToMerge` now defaults to `false`                                                                                                                       | **recreate** (NOT NULL column, no backfill) |
| 0.2.2      | 2026-06-22 | none                                                                                                                                                                   | —                                           |
| 0.2.1      | 2026-06-20 | none                                                                                                                                                                   | —                                           |
| **0.2.0**  | 2026-06-20 | `allowedChildBlocks` removed → `structure`; `allowChildren` enforced                                                                                                   | —                                           |

“Recreate” is the pre-0.2.12 beta stance: those releases changed the schema with no
backfill path, so the documented upgrade was to recreate the database. From 0.2.12
on, schema changes are picked up with `createcms generate` + a Drizzle migration.

---

## Unreleased

- **`BlockComponentProps` gains a required `edit` prop and its `properties`
  is no longer `| undefined`.** Every block component the renderer calls now
  receives `edit` (`{ active, block, field }`, plain data — `NO_EDIT` outside
  an editor, anchors with `edit="preview"`). Components that ignore `edit`
  keep compiling. `properties` is always an object at runtime and is typed
  that way now.
  → **Migration:** code that renders a block component itself (tests,
  stories, custom canvases) passes `edit={NO_EDIT}` (from
  `@createcms/core/react/blocks`); drop `properties?.` optional chaining if
  you like — it still compiles.

- **`@createcms/react`: `useChildren(parentId)` returns child refs instead of
  ids.** Each entry is `{ id, type, index }` (the factory's `useChildren`
  narrows `type` to the schema's block types), so a row can render its label
  and position without a second hook. The array keeps its identity until ids
  or types change.
  → **Migration:** replace `useChildren(id).map((childId) => ...)` with
  `useChildren(id).map((child) => ... child.id ...)`; nothing else changes.

---

## 0.6.0 — 2026-08-14

**No API breaks.** One behaviour change worth knowing about before you upgrade:

- **Three-way merges auto-resolve more.** Blocks where source and target changed
  _disjoint_ sets of top-level properties now merge automatically (git-style: block
  ≈ file, property ≈ line) instead of being reported as conflicts. Same-key edits
  (including `richText`), delete-vs-edit, type changes, and divergent children still
  conflict. `checkConflicts` and `createMergeRequest` responses gain
  `autoMergeableBlockIds` (additive).
  → **Migration:** none required. A UI that assumed "any two-sided edit on one block
  is a conflict" will now see fewer conflicts; nothing to change, but review any
  test that asserted a conflict count.

## 0.5.0 — 2026-08-03

- **`media.uploadAssets` and `media.replaceAsset` no longer exist on the client's
  inferred types.** Both take an in-process `buffer: Blob | ArrayBuffer` that cannot
  survive the client's JSON request body, so a browser call type-checked and then
  failed at runtime. They are now marked `scope: 'server'` and the client type
  builder omits them — `client.media.uploadAssets(…)` is a compile error.
  → **Migration:** browser callers use the signed flows —
  `createSignedUpload` for uploads, `createSignedReplace` + `commitReplace` (or the
  `client.media.useReplaceAsset()` hook / the `client.media.replaceState` atom in the
  vanilla client) for replaces. Server-side `cms.api.media.uploadAssets` /
  `replaceAsset` are unchanged and still fully callable.
  This is a **type-level** guard only: the client's request proxy still dispatches
  any method name it is handed, so an `as any` escape hatch reaches the same route
  and fails exactly as before.

- **Upload/replace failures no longer return the S3 provider error to the client.**
  `uploadAssets` and `replaceAsset` used to put the raw provider message on
  `data.cause`, which reached the wire. The full detail is still logged server-side;
  the client-facing error is trimmed to a status code.
  → **Migration:** anything reading `err.data.cause` for storage-error detail must
  read it from your server logs (or your `onAPIError` sink) instead.

## 0.4.0 — 2026-08-02

The release with the largest blast radius for consumers: it changes how the package
is _loaded_, not just what it exposes.

### Packaging and runtime

- **`@createcms/core` is ESM-only.** The CommonJS build is gone: the `main` and
  `module` fields are removed and every `exports` subpath resolves to ESM only.
  → **Migration:** CommonJS projects do **not** need to convert to `import` — Node
  resolves ESM from `require()` natively since 22.12, so `require('@createcms/core')`
  keeps working. Bundlers and tooling that resolved through `main`/`module` need to
  respect the `exports` map.
- **Minimum Node is now 22.12** (`engines.node` was `>=20`). This is the direct
  consequence of dropping the dual build: 22.12 is where `require(esm)` landed.
  → **Migration:** raise your runtime (and CI matrix) to Node ≥ 22.12.
  Dropping the dual build also removed the dual-package hazard — the client layer
  holds module-level state in nanostores atoms, and a graph that loaded both copies
  ended up with two independent stores.
- **The `next` peer range moved from `>=16` to `>=16.2.11`.** Every 16.x below that
  carries nine security advisories, four high (SSRF in Server Actions, an App Router
  middleware/proxy bypass, SSRF via rewrites); createCMS ships a `next/middleware`
  integration, so the exposure is real rather than theoretical.
  → **Migration:** upgrade Next to ≥ 16.2.11. `next` remains an _optional_ peer —
  projects not using Next.js are unaffected.

### API

- **`duplicateBlock` requires `targetParentBlockId`** and is child-duplication only.
  Omitting it used to mint a new top-level root while the endpoint declared only
  `block:create`, so a host granting `block:create` and denying `root:create` could
  be bypassed through duplication. Its return type is no longer a union (`mode` is
  always `'child'`).
  → **Migration:** to duplicate a subtree into a new top-level entry, call
  `duplicateRoot` — same arguments, and it has always been guarded as `root:create`.
  Callers that narrowed the old union return can drop the narrowing.
- **`publishRelease` now declares `publication:create`** (was `release:update`),
  matching `publishBranch`.
  → **Migration:** hosts that grant `release:update` for release curation must also
  grant `publication:create` to allow publishing.
- **`listMentions` no longer accepts a `mentionedUserId` query parameter.** It
  filtered on the caller-supplied value, letting any caller read another user's
  mention inbox; the filter is now derived from the session user.
  → **Migration:** drop the parameter. The endpoint always returns the session
  user's mentions.
- **`ApprovalOutput.branchId` is now `string | null`.** It is `null` for approvals
  whose branch has since been deleted.
  → **Migration:** handle `null` wherever you read `branchId` off an approval.

### Validation (previously-accepted input now throws)

- **`createBlock.position` is `z.number().int().min(0)`.** A negative value used to
  silently insert near the end of the parent's children (it went straight into
  `Array.prototype.splice`) and a fractional value was truncated. The insert index is
  now clamped to the child count.
- **`targetProperties` on the duplicate paths is parsed against the per-block
  property schema** (`buildPropertiesSchema`) instead of being cast. Declared
  constraints — `maxLength`, numeric ranges, required keys — now apply to
  duplication too.
  → **Migration for both:** writes that relied on the old lax behaviour now fail with
  a validation error. Fix the payloads.

### Database

- **`merge_requests.source_branch_id`, `merge_requests.target_branch_id` and
  `approvals.branch_id` are nullable with `ON DELETE SET NULL`.** `deleteBranch`
  previously threw a raw foreign-key error on any branch that had been merged or had
  an approval request, so the standard branch → merge request → merge → delete
  workflow failed at the last step with an opaque 500 and left the branch permanently
  undeletable. Merge and approval history now survives the branch row. Open merge
  requests and publications still block deletion.
  → **Migration:** run `createcms generate` and apply a Drizzle migration
  (`drizzle-kit generate`) after upgrading.

## 0.3.0 — 2026-07-11

- **`getDiff`'s response shape and `moved` semantics changed.** The response is now
  `{ diff, tree, summary, sourceCommitId, targetCommitId, commonAncestorCommitId }`,
  with a new `view` query param (`'list' | 'tree' | 'both'`, default `'both'`).
  - `moved` is identity-based: a block is flagged only when it was reparented or is a
    true reorder outlier among surviving siblings (LIS-based). Siblings whose index
    merely shifted are no longer flagged — inserting one block among N siblings yields
    one diff entry instead of N+2.
  - `childrenReordered` is only set when the relative order of a parent's surviving
    common children actually changed, never for pure additions/removals.
  - A draft-slug change on the root yields `slugChange: { from, to }` instead of an
    opaque `modified`, and the reserved `__slug` key no longer leaks into returned
    version properties.
  - Modified entries carry `propertyChanges`, `typeChange`, and word-level `textDiff`
    segments; `tree` is the draft tree with per-node `diff` annotations and deleted
    blocks re-inserted as ghost nodes.
    → **Migration:** consumers reading the old top-level array must read `diff` (or
    `tree`) off the new envelope; request `view: 'list'` if you don't want the tree
    built. Diff UIs that counted on the noisy `moved` flag will see far fewer entries.
    New exported types: `ChangeType`, `PropertyChange`, `TextDiffSegment`, `MovedInfo`,
    `BlockChange`, `DiffSummary`, `BlockDiffAnnotation`, `AnnotatedBlockTreeNode`,
    `DiffView`.

- **`duplicateRoot`'s permission resource is `root`, not `block`.** It mints a new
  top-level root — the same privileged act `createRoot` guards as `root` — but its
  metadata said `block`, so a consumer granting `block:create` while denying
  `root:create` could create roots through duplication.
  → **Migration:** remap `duplicateRoot` from `block` to `root` in any
  `authMiddleware` permission matrix.

- **GET boolean query flags decode wire-safely.** `z.coerce.boolean()` turns the wire
  string `'false'` into `true`, so passing `false` over HTTP inverted the flag. The
  last affected flags — `listBranches` (`isDeletable` / `hasPublications` /
  `hasOpenMergeRequests`), `listRoots` (`hasPublications`), `notifications.list`
  (`unreadOnly`), `getBlockTree` (`raw` / `includeReferencePreviews`),
  `getPublishedContent` (`raw`), `listAssets` (`unfiled`) and the media asset gate
  (`download`) — now use `wireBooleanSchema`.
  → **Migration:** none for correct callers; in-process callers passing real booleans
  were never affected. HTTP callers that had worked _around_ the inversion (passing
  nothing to mean false, or `false` to mean true) must send the honest value.

- **`collectRootExecutionPlans` is removed.** It loaded every root with no limit and
  serially ran the full per-root planning bundle — an unbounded N+1. It had no
  callers, was never re-exported from the package entrypoint, and had no `./admin`
  subpath, so it was unreachable from outside the repo.
  → **Migration:** none expected. The production entry point, `runPruningPass`, does
  the budgeted equivalent (bounded by `maxRoots` / `maxDurationMs`).

- **Dependency floor:** `fast-xml-parser` moved from `^5.4.2` to `^5.7.0` so
  consumers cannot resolve a version affected by the `<5.7.0` prototype-pollution /
  XML-injection advisory.

## 0.2.12 — 2026-07-09

The largest breaking release in the project's history — shipped as a _patch_, before
the "minor is the breaking channel" rule existed. Eleven passes landed at once. If
you are upgrading across this version, budget real time.

### Security (fails secure by default)

- **`authMiddleware` is now required.** `createCMS` throws at construction if it is
  missing, so auth can never be silently absent. The undocumented `middleware` alias
  was removed.
  → **Migration:** to run with no auth on purpose (public/dev), pass the new
  `allowAnonymous()` export — byte-identical to the old omitted-middleware behaviour.
- **`media.allowedMimeTypes` defaults to an explicit allowlist:** `image/png`,
  `image/jpeg`, `image/webp`, `image/gif`, `video/mp4`, `video/webm`,
  `application/pdf`. No `image/*` / `video/*` wildcards, so `image/svg+xml` (a
  stored-XSS vector) is excluded by default. Uploads carrying file bytes are also
  checked against their real magic bytes, so a file declared `image/png` but
  containing SVG/HTML is rejected before it reaches storage.
  → **Migration:** re-add any format you relied on through the wildcards (avif, heic,
  mov, …) explicitly.
- **`user.exposeColumns` is required when a `user` table is configured.** It
  defaulted to _every_ column, leaking password hashes and tokens through `withUser`;
  `resolveUserConfig` now throws instead.
  → **Migration:** name the safe columns explicitly.
- **The multi-tenant slug is no longer read from the request body/query by default.**
  `resolveTenantSlug` returns the session-derived fallback and ignores
  request-supplied slugs unless you opt in with `{ allowRequestOverride: true }`
  (intended only behind an admin check).
  → **Migration:** opt in explicitly if you were relying on request-supplied tenants.
- **Approval endpoints no longer accept `reviewedBy` / `requestedBy` from the request
  body** (spoofable). The actor is derived from the auth context, and a reviewer must
  match one of `requestedReviewers`.
- **`search.query` applies the same read boundary as normal endpoints.** A result is
  returned only if its underlying entity is visible under the active scope, and
  notifications are filtered to the requesting user — closing a cross-tenant content
  leak and a cross-user notification-title leak.
  → **Migration:** none, but expect fewer results under a scoping plugin. With no
  scoping plugin active, behaviour is unchanged.

### Renames

Endpoints and parameters:

- `deleteRoot` → **`archiveRoot`** (it soft-archives).
- `search.search` → **`search.query`**, and its param `q` → **`search`**.
- `notifications.listNotifications` / `templates.listTemplates` /
  `variables.listVariables` → **`.list`**.
- `media.archiveAsset` → **`archiveAssets`**; `media.updateAssetStatus` →
  **`updateAssetsStatus`**.
- List direction unified to **`sortDirection`** (was `sortOrder` on `listAssets` /
  `listPublications`).
- `moveRoot` body param `sortOrder` → **`position`** (the _result_ field stays
  `sortOrder`).
- Template endpoints' `id` → **`templateId`**; `listFolders`' `parentId` →
  **`parentFolderId`**.
- `resolveConflicts` → **`applyConflictResolutions`**; `approve` →
  **`submitApproval`**; `reject` → **`submitRejection`**.
- `resolveTemplate` is now a **GET**.
- `moveFolder` accepts an explicit `null` parent (detach), matching `moveRoot` /
  `moveAssets`.

Config and types:

- `slug.root` → **`slug.prefix`**; `slug.allowRoot` → **`slug.allowIndex`**.
- Permission resources are singular: `'variables'` → **`'variable'`**, `'templates'`
  → **`'template'`**. A new exported `CMSPermissionResource` union makes a typo in a
  permission matrix a compile error.
- Context types standardised on the `Context` suffix: `CMSMiddlewareCtx`,
  `CMSProcedureCtx`, `CMSHandlerCtx`, `CMSSystemHandlerCtx` → `…Context`. The
  duplicate `CMSEndpointCtx` is removed — use `CMSEndpointContext`.
- `RootListItem` / `RootSummary` expose their own key as **`id`** (was `rootId`).
- `CMSClientStore.notify(signal)` → **`invalidate(signal)`** (distinct from
  `cms.notify`, which sends a user notification).
- `cms.$notifications` → **`cms.$InferNotifications`**.
- `createBlocksRenderer` is **removed** — use `createContentRenderer`, or
  `createBlocksMap` + `BlocksRenderer` for the low-level path.
- Type-prefix cleanups: `ABTest*` → `AbTest*`; `GA4Payload` / `GA4ServerConfig` →
  `Ga4Payload` / `Ga4ServerConfig`; `CMSEvent` → `AnalyticsEvent`;
  `MultilingualMiddlewareResult` → `I18nMiddlewareResult`; generic param `TCms` →
  `TCMS`; zod export `notificationEvent` → `notificationEventSchema`; client types
  `QueryState` / `MediaUploadState` / `MediaUploadFileState` / `MediaUploadOptions`
  → `CMS`-prefixed.
- The bundled multi-tenant plugin's id changed `multi-tenant` → **`multiTenant`**
  (plugin ids must now be valid JS identifiers).
- Removed exports: `$InferServerPlugin`, `InferPluginRealtimeEvents`, and the
  `resolveWireName` re-export from the `'use client'` tracking module (import it from
  the core entry, server-side).
- The vanilla client exposes `media.uploadState` (a real atom) instead of a mistyped
  `useUploadAssets`.

### Return shapes

Pre-1.0, these replaced the old shapes cleanly — there are no compat shims.

- **Commit envelope.** Every commit-producing mutation (`createRoot`, `createBlock`,
  `moveBlock`, `deleteBlock`, `duplicateBlock`, `updateBlock`, `updateBlocks`,
  `updateRoot`, `revertBranch`, `executeMerge`) returns
  `{ commit: { id, message, createdAt, createdBy }, … }` — replacing the three
  divergent keys `commitId` / `newCommitId` / `mergeCommitId`. A fast-forward
  `executeMerge` returns the resulting head commit instead of `mergeCommitId: null`.
  `updateBlocks` adds `changed: boolean` so a no-op save is distinguishable.
- **Entity envelope.** `createBranch` / `renameBranch` → `{ branch, isDeletable }`;
  `createMergeRequest` → `{ mergeRequest, hasConflicts, conflicts }`;
  `update` / `close` / `reopenMergeRequest` → `{ mergeRequest }`; `publishBranch` →
  `{ publication }` (now including `branchName`); approval mutations →
  `{ approval }`; comment message mutations → `{ message }`.
- **`getRootHistory` returns `{ commits, total, hasMore }`** (was
  `{ data, total, offset, limit }`). `listTemplates` / `listVariables` gain
  `limit` / `offset` / `search` and return `{ …, total, hasMore }`.
- **`getRoot` / `getRootBySlug` return the full `RootListItem`** (counts + path), not
  a bare summary.
- `updateAssetStatus` returns `{ updated, updatedIds, skipped }`;
  `deleteTemplate` / `deleteVariable` echo the deleted id (`{ templateId }` /
  `{ variableId }`) instead of `{ deleted: true }`; `deleteBlock` returns
  `deletedBlockIds`; `unpublishBranch` returns `unpublishedCommitId` /
  `unpublishedAt`; `uploadAssets` / `replaceAsset` return the full asset row.
- **Type fixes:** `getRootHistory.createdAt` and `createSignedUpload.expiresAt` are
  real `Date`s (were an ISO string / epoch-ms) on the server API.
- **`getDiff`, `checkConflicts` and `checkDivergence` are now GET** (were POST).
- **The HTTP client types every timestamp as the ISO `string` the wire actually
  delivers**, via a `Serialize<T>` mapped type at the client boundary. Server-side
  `cms.api.*` still returns real `Date`s.
  → **Migration:** client-side code that treated a timestamp as a `Date` must parse
  it. This makes an existing runtime reality visible to the type checker rather than
  changing behaviour.

### Content and validation

- **The root `slug` is versioned content.** `updateRoot` commits the slug to the
  branch instead of writing the global `roots.slug`; the live URL only changes when
  the branch is published, and `revertBranch` restores the slug with the content.
  `createRoot` leaves the live slug unset until the first publish. Uniqueness is
  enforced **at publish** (new typed `PUBLISH_SLUG_CONFLICT`; an atomic
  `publishRelease` rolls the whole release back on conflict) rather than at
  draft-write, and slug-change redirects are created at publish, so a never-published
  slug edit creates no redirect. Two branches editing the slug now produce a normal
  root-block merge conflict instead of a silent overwrite.
  → **Migration:** no schema migration (the draft slug rides an existing JSONB
  column), but run the `backfillDraftSlugs` script so existing entries have a draft
  slug to edit and re-publish. `parentRootId` / `moveRoot` are unchanged — a page move
  still changes the live URL immediately.
- **`updateBlocks` enforces structural validation**, matching the single-block
  routes: the posted root `blockId` must equal the entry root, every written block
  type must exist, each written block's properties are validated against its type
  schema, and placement is asserted over the tree. Validation is diff-scoped — new
  blocks strictly, updated blocks and the root with patch semantics, unchanged blocks
  untouched.
- **Stricter property validation:** `date` is validated as an ISO datetime;
  string/number properties honour declarative `minLength` / `maxLength` / `pattern` /
  `min` / `max`; and `image` / `reference` ids (including inside lists) must **exist**
  at write time.
  → **Migration:** writes that previously stored an invalid date or a dangling id now
  throw a validation error instead of failing later at render.
- **Required links are enforced:** a `required` link with an empty target
  (`url` / `rootId` / `email` / `phone`) is rejected instead of silently passing.
- **`executeMerge` blocks by default when an OPEN approval request exists** on the
  merge (previously only enforced behind the governance flags), mirroring
  `publishBranch`. A merge with no approval requests is unaffected.
- **`deleteCommentMessage` reports `operation: 'delete'`** to your `authMiddleware` /
  permission matrix (was `'update'`).
  → **Migration:** update any permission matrix keyed on `'update'` for that endpoint.
- **Reopening a comment thread emits a `threadReopened` notification** (was
  incorrectly `threadResolved`).
- **`getPublishedContent` no longer serialises the A/B control branch twice.** The
  control tree is the top-level `tree` / `properties`, and `abTest.variants` carries
  only the non-control variants.
  → **Migration:** read the control snapshot from the top-level tree.
- **`RevalidateEvent.slug` is renamed `storedSlug`**, and every URL-shaped value in
  `paths` is a leading-slash path, so using an event value as a Next.js cache tag no
  longer silently fails to bust.
  → **Migration:** read `event.paths` (for tags) or `event.storedSlug` (the bare
  slug).
- **List endpoints parse raw timestamps as UTC** (`listRoots`, root history,
  `listMergeRequests`), fixing an off-by-timezone `Date` on non-UTC hosts.

### Construction-time throws (previously silent)

- `createCMS` throws when a collection name collides with a reserved namespace
  (`admin` / `media` / `variables` / `templates` / `search` / `notifications` /
  `realtime`) or a plugin id, or isn't a URL-safe slug. Such a collection used to be
  silently clobbered and its routes 404'd.
- Plugin ids must be valid JS identifiers and every plugin endpoint path must be
  `/<id>/<method>`.
- Endpoint-conflict detection spans the full core + collection + plugin surface and
  **throws** on a duplicate path (was plugin-only and a `console.warn`).
- The config hook `action` is a closed union of endpoint keys (the `(string & {})`
  escape hatch is gone), so a misspelled action is a compile error rather than a
  silent no-op.
- `definePluginSchema` is curried — `definePluginSchema<CoreTables>()({ … })` — so
  the schema DSL is actually type-checked.

### Errors

- **State-conflict codes are now `409`** (were `400`): `BRANCH_NAME_ALREADY_EXISTS`,
  `MERGE_REQUEST_ALREADY_EXISTS`, `ROOT_HAS_CHILDREN`, `FOLDER_HAS_CONTENT`,
  `BRANCH_HAS_PUBLICATIONS`, `BRANCH_HAS_OPEN_MERGE_REQUESTS`.
  → **Migration:** update any client branching on the status code.
- **Removed never-thrown codes:** `MERGE_REQUEST_OUTDATED`, `COMMENT_BODY_REQUIRED`,
  `AB_TEST_WEIGHTS_INVALID`, and the decorative `media-optimize` `$ERROR_CODES`.
- Network/transport failures (offline/DNS/CORS) are now wrapped in `CMSClientError`
  (`status: 0`, `code: 'NETWORK_ERROR'`), so `err instanceof CMSClientError` holds
  where it previously didn't.
- The Next revalidate webhook returns the standard `{ message }` error shape and
  rejects malformed JSON with a clean `400`.

### Database

- **New tables:** `scheduled_publications`, `releases`, `release_items` (scheduled
  publishing/expiry and atomic multi-page releases).
- **Index changes:** a `(collection, slug)` index on `roots` for the public
  `getPublishedContent` slug lookup; the unused `bv_properties_gin` GIN index on
  `block_versions.properties` removed (it could not serve any existing query and only
  cost write amplification on the highest-churn table).
- **`createcms generate` now emits `export const cmsSchema = pgSchema('cms')`** (was
  `cms`), so `typeof cms` no longer collides with your `createCMS` instance.
  → **Migration:** run `createcms generate` and add a Drizzle migration. Update any
  import of the generated `cms` schema export to `cmsSchema`.

## 0.2.11 — 2026-06-29

No breaking changes.

## 0.2.10 — 2026-06-29

No breaking changes. (`useNotifications` accepts your typed client directly, and
`userId` became optional — both strictly loosening.)

## 0.2.9 — 2026-06-29

- **The media gate is addressed by asset id: `GET /media/asset/{id}`** (was the asset
  slug). The id is exactly what content stores, so `<img src="/media/asset/{id}">`
  survives swapping the bytes behind an asset with no content change and no
  re-render. The redirect is short-cached (`max-age=300`, no longer `immutable`) so a
  swap propagates within minutes, while the object bytes stay long-cached at the CDN.
  → **Migration:** rewrite any hand-built `/media/asset/<slug>` URL to use the id. A
  CDN in front of the gate must include the query string in its cache key (the
  redirect target varies by `?format` / `?w` / `?download`).
  Two latent gate bugs were fixed alongside — the route was registered with OpenAPI
  `{param}` braces (rou3 only matches `:param`, so every request 404'd before the
  handler ran) and the handler returned a `{ headers, body }` object better-call never
  applies — which is why the gate had never worked over real HTTP.
- **The 0.2.8 image read-path resolution is reverted.** An `image` block property is a
  plain asset-id string again on both the write and read paths; `resolveImageAssets`
  and the `ResolvedImage` type are gone.
  → **Migration:** anyone who adopted `{ id, slug }` in 0.2.8 reads the id directly
  and builds the gate URL from it.

## 0.2.8 — 2026-06-28

- **`image` block properties resolve to `{ id, slug }` on the rendered read path.**
  `getPublishedContent` (and `getBlockTree` unless `raw`) resolved each stored asset
  id, exactly as `link` and `reference` properties are resolved; in `resolved` mode an
  `image` property inferred as `ResolvedImage` (`{ id, slug } | null`).
  → **Migration:** **reverted one release later, in 0.2.9.** If you are upgrading
  across both, skip it entirely — an `image` stays a plain id string.

## 0.2.7 — 2026-06-28

- **`getAssetUrlAuthenticated` is removed** (with the internal `signGetObject`
  helper). Uploaded objects are `public-read`, so the presigned-GET path was
  redundant: `status` is a visibility flag gating the public gate redirect, not a hard
  privacy boundary.
  → **Migration:** serve assets through the gate, and flip an asset to `public` with
  `updateAssetStatus` to make it servable there. For admin display, `listAssets` (and
  the `createSignedUpload` / `uploadAssets` responses) now include a direct object
  `url` per asset — it bypasses the gate, so it is for internal tooling, not for
  embedding in content.

## 0.2.6 — 2026-06-26

- **Schema change, no backfill (beta):** the `content_usage_target` enum gains
  `'link'`, for the new `link` block-property type.
  → **Migration:** recreate the database.

## 0.2.5 — 2026-06-26

- **`createTemplate` rejects a template whose `propertyKey` does not exist on the
  block type, or is not a text property** (`string` / `richText`), with the new
  `TEMPLATE_PROPERTY_INVALID` error. A string template can no longer be seeded into a
  number/select/image/reference field.
  → **Migration:** fix or drop such templates before upgrading.
- **`createBlock` seeds unset optional properties from templates server-side.**
  Required properties must still be provided (input is validated before defaults
  apply), caller-provided values always win, and `duplicateBlock` / `updateBlocks` do
  not re-apply templates.
- **Templates and variables are scoped** by the `i18n` (per language) and
  `multi-tenant` (per tenant) plugins, and their core uniqueness moves from a DB
  unique index to app-level per-scope enforcement.
- **Schema change, no backfill (beta):** the `templates` and `variables` unique
  indexes are demoted to non-unique lookup indexes, and the `i18n` / `multi-tenant`
  plugins add a `language` / `tenant_slug` column to both tables.
  → **Migration:** recreate the database.

## 0.2.4 — 2026-06-26

- **`branchProtection.protectMain` is removed, replaced by
  `branchProtection.protectPublishedBranches`** — and the semantics differ.
  `protectMain` protected the default branch _by name_; the replacement locks a
  branch against direct content mutations for exactly as long as it is **published**.
  This applies to _any_ published branch (a root can have several at once, e.g. A/B
  variants), not just the default one, and a never-published branch is freely
  editable. Enforced by a shared `assertBranchWritable` guard on every
  content-mutation route, including `revertBranch`; `createRoot` is never gated; still
  throws `PROTECTED_BRANCH` (403).
  → **Migration:** rename `protectMain: true` to `protectPublishedBranches: true`, and
  note that protection now follows publication state rather than branch name — changes
  go via another branch + merge, then a re-publish; unpublishing makes the branch
  directly editable again.

## 0.2.3 — 2026-06-25

- **`branchProtection.requireApprovalToMerge` defaults to `false`.** Previously
  `executeMerge` **always** required approvals; merges now succeed without approval
  unless you opt in.
  → **Migration:** set `requireApprovalToMerge: true` explicitly to keep the prior
  gate. This one is silent — nothing fails, the gate simply stops applying.
- **Schema change, no backfill (beta):** commits gain `branchId` and a NOT NULL
  `origin_branch_name`, so `getRootHistory` attributes each commit to the branch it
  was created on deterministically instead of via a "nearest branch tip wins"
  heuristic that mis-attributed shared ancestors.
  → **Migration:** recreate the database. There is no migration of existing commit
  rows.

## 0.2.2 — 2026-06-22

No breaking changes.

## 0.2.1 — 2026-06-20

No breaking changes.

## 0.2.0 — 2026-06-20

- **`allowedChildBlocks` is removed, replaced by the collection-level `structure`
  map.** `structure` is keyed by parent block name (or the literal `'root'`) with
  three mutually exclusive modes per entry: open (`{}` / `{ accepts: '*' }`),
  whitelist (`{ accepts: ['x'] }`, fail-closed), or blacklist
  (`{ excludes: ['x'] }`, fail-open). A concrete `accepts` list together with
  `excludes` is a compile error, and block names autocomplete against the
  collection's blocks.
  → **Migration:** express the same intent with `structure` — e.g.
  `structure: { section: { accepts: ['featureItem'] } }`.
- **`allowChildren` is enforced on the server:** a block without
  `allowChildren: true` rejects all children (the root always accepts children).
  `createBlock`, `moveBlock` and `duplicateBlock` enforce the rules and throw the new
  `BLOCK_NOT_ALLOWED_IN_PARENT` error; the visual editor reads the same rules for
  drop-zone gating, so the two cannot diverge.
  → **Migration:** declare `allowChildren: true` on every block that holds children.

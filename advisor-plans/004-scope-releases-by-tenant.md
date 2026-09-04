# Plan 004: Scope releases by plugin scope so tenants cannot see or mutate each other's releases

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b6a71a6..HEAD -- packages/cms/src/core/routes/releases.ts packages/cms/src/core/endpoint.ts packages/cms/src/core/types/definitions.ts packages/cms/src/plugins/multi-tenant packages/cms/src/core/routes/test/releases.test.ts BREAKING-CHANGES.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (schema change under the multi-tenant plugin; consumers must regenerate + migrate)
- **Depends on**: 006 (both edit `releases.ts`; 006 is small — land it first)
- **Category**: security
- **Planned at**: commit `b6a71a6`, 2026-09-04

## Why this matters

Every other first-class table (roots, assets, folders, redirects, templates,
variables) is scoped: the multi-tenant plugin adds a `tenant_slug` column and
a `WHERE` predicate that the endpoints AND into their reads, and inserts go
through `scopedInsert` so the column is stamped. Releases were added later and
never joined that mechanism. `releases.ts` is `scope: 'system'` and none of
its reads or writes reference `ctx.context.scope`, except `publishRelease`,
which forwards the root scope into the publish primitive.

Under multi-tenant, any caller with the `release` permission in tenant B can
list tenant A's releases (titles, root ids, branch ids), read them, change
their items, and add tenant A's roots to tenant B's own release. That is a
cross-tenant IDOR on a first-class entity. Single-tenant deployments are
unaffected (no predicate).

After this plan: `releases` is a scoped table like the others; the multi-tenant
plugin stamps and filters it; every release read/write ANDs the predicate; and
every root added to a release must pass the same in-scope check the by-id
endpoints use. Single-tenant behaviour is unchanged.

## Current state

Files:

- `packages/cms/src/core/routes/releases.ts` — all release endpoints. `META = { scope: 'system', permissionResource: 'release' }` (line 46). `assertItemExists(db, rootId, branchId)` (lines 58-74) checks root/branch existence with no scope. `createRelease` (line ~88) inserts with Drizzle directly. `getRelease` (~270), `listReleases` (~300), `assertDraftRelease` (~492) read by id/status with no scope.
- `packages/cms/src/core/endpoint.ts` — `computeScope` (lines ~103-172) merges plugin scope factories over a hard-coded table list: `['roots','assets','assetFolders','redirects','templates','variables']` (line ~110-119).
- `packages/cms/src/core/types/definitions.ts` — `ResolvedScope` (lines 210-240) has keys `roots?`, `assets?`, `assetFolders?`, `redirects?`, `templates?`, `variables?` (+ resolver slots).
- `packages/cms/src/plugins/multi-tenant/schema.ts` — `multiTenantSchema = definePluginSchema<CoreTables>()({ extend: { roots: {...}, assetFolders: {...}, assets: {...}, redirects, templates, variables } })`, each adding `tenantSlug: { type: 'text', notNull: true }` plus indexes.
- `packages/cms/src/plugins/multi-tenant/index.ts` — the scope factory (lines ~100-131) returns one `{ where: sql\`"cms"."<table>"."tenant_slug" = ${tenantSlug}\`, insertColumns }` entry per table.
- `packages/cms/src/core/scope.ts` — `scopedInsert(db, tableName, values, scope)` builds a raw INSERT including `scope.insertColumns` (lines 87-118).
- `packages/cms/src/core/blocks/guards.ts` — `requireRootInScope(exec, rootId, collection, rootScope, notFound)` (lines 24-46), the by-id IDOR choke point.
- `packages/cms/src/core/db/core-schema.ts` — `releases` table definition at line ~1074, `releaseItems` at ~1100.
- `packages/cms/src/plugins/multi-tenant/test/multi-tenant.test.ts` and `test/utils/cms.ts` — `setupMultiTenantTestCMS()` returns `{ cms, db, setTenant }`; tests call `setTenant('acme')` then hit `cms.api.*`.
- `packages/cms/src/core/routes/test/releases.test.ts` — release endpoint tests using `setupTestCMS()`.
- `BREAKING-CHANGES.md` — has a `## Unreleased` section (line 53); every schema-affecting change gets an entry there (CONTRIBUTING "Marking breaking changes").

Excerpts.

`assertItemExists` (`releases.ts:58-74`):

```ts
async function assertItemExists(
  db: DrizzleInstance,
  rootId: string,
  branchId: string,
): Promise<void> {
  const [root] = await db
    .select({ id: roots.id })
    .from(roots)
    .where(eq(roots.id, rootId));
  if (!root) throw new CMSError('ROOT_NOT_FOUND');
  const [branch] = await db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.rootId, rootId)));
  if (!branch) throw new CMSError('BRANCH_NOT_FOUND');
}
```

`createRelease` handler (`releases.ts:~97-105`):

```ts
const [release] = await db
  .insert(releases)
  .values({ title: ctx.body.title, createdBy: ctx.context.userId ?? null })
  .returning();
return { release };
```

`getRelease` (`releases.ts:~284-295`): `db.select().from(releases).where(eq(releases.id, ctx.query.releaseId))`, then items by `releaseItems.releaseId`.

`listReleases` (`releases.ts:~333-347`): `where = status ? eq(releases.status, status) : undefined`, applied to both the page query and the count query.

`assertDraftRelease` (`releases.ts:~492-503`): `db.select({ status: releases.status }).from(releases).where(eq(releases.id, releaseId))`.

`publishRelease` locks the release with `.for('update')` (line ~404-409) and
already passes `scopeWhere: ctx.context.scope.roots?.where` etc. into
`publishBranchInTx` (lines ~455-458).

`computeScope` table list (`endpoint.ts:110-119`):

```ts
for (const table of ['roots','assets','assetFolders','redirects','templates','variables'] as const) {
```

Multi-tenant scope factory entry shape (`plugins/multi-tenant/index.ts:~112-115`):

```ts
assets: {
  where: sql`"cms"."assets"."tenant_slug" = ${tenantSlug}`,
  insertColumns,
},
```

Multi-tenant schema entry shape (`plugins/multi-tenant/schema.ts`, the
`templates`/`variables` entries — copy one of those, they are the simplest):
`{ columns: { tenantSlug: { type: 'text', notNull: true } }, indexes: { tenantIdx: { columns: ['tenantSlug'] } } }`.

How another system-scoped endpoint applies a scope predicate: see
`packages/cms/src/core/routes/variables.ts` or `templates.ts` — they push
`scope.variables?.where` / `scope.templates?.where` into an `and(...)` and
insert via `scopedInsert(db, 'cms.variables', {...snake_case columns...}, scope.variables)`.
Note `scopedInsert` takes **snake_case** column names (it emits raw SQL) and
returns the raw row with snake_case keys.

## Commands you will need

| Purpose    | Command                                                                                                                       | Expected on success |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Install    | `bun install --frozen-lockfile`                                                                                               | exit 0              |
| Typecheck  | `bun run --filter=@createcms/core check-types`                                                                                | exit 0              |
| Tests      | `cd packages/cms && bunx vitest run src/core/routes/test/releases.test.ts src/plugins/multi-tenant/test/multi-tenant.test.ts` | all pass            |
| Full suite | `bun run --filter=@createcms/core test`                                                                                       | all pass            |
| Lint       | `bun run lint && bunx oxfmt --check`                                                                                          | exit 0              |
| Sync docs  | `node scripts/sync-changelog.mjs --check`                                                                                     | exit 0              |

(From `CONTRIBUTING.md` and `.github/workflows/ci.yml`; not executed by the advisor.)

## Scope

**In scope**:

- `packages/cms/src/core/types/definitions.ts` — add `releases?: TableScope` to `ResolvedScope`
- `packages/cms/src/core/endpoint.ts` — add `'releases'` to the `computeScope` table list
- `packages/cms/src/plugins/multi-tenant/schema.ts` — extend `releases`
- `packages/cms/src/plugins/multi-tenant/index.ts` — add the `releases` scope entry
- `packages/cms/src/core/routes/releases.ts` — apply the scope everywhere
- `packages/cms/src/plugins/multi-tenant/test/multi-tenant.test.ts` — isolation tests
- `packages/cms/src/core/routes/test/releases.test.ts` — only if an existing test breaks on the `scopedInsert` return shape
- `BREAKING-CHANGES.md` — `## Unreleased` entry
- `.changeset/releases-scoped.md` (create, **minor** bump)
- `packages/cms/src/plugins/multi-tenant/README.md` — one line listing `releases` among scoped tables, if such a list exists

**Out of scope**:

- The i18n plugin — it scopes `roots` by language, not releases; do not add a
  `releases` entry there.
- `release_items` — scoped transitively through its release and its root; no column.
- The docs-endpoints/docs-config tests — response shapes do not change.
- Any generated schema files under `examples/` — consumers regenerate.

## Git workflow

- Branch: `advisor/004-releases-scope`
- PR title / commit (breaking, so it carries `!` and a footer):

  ```
  feat(releases)!: scope releases by plugin scope

  Releases are now a scoped table: the multi-tenant plugin adds tenant_slug
  to cms.releases and every release endpoint applies the scope predicate.

  BREAKING CHANGE: with the multiTenant plugin, run `createcms generate` and
  apply the migration that adds `releases.tenant_slug` (NOT NULL). Existing
  release rows need a tenant_slug backfill before the NOT NULL constraint
  can be applied.
  ```

- Changeset `.changeset/releases-scoped.md` with `'@createcms/core': minor`
  (pre-1.0, minor is the breaking channel) and the same summary. The
  `commits` CI job requires a `minor` changeset to be paired with `!`.
- Add under `## Unreleased` in `BREAKING-CHANGES.md` an entry in the style of
  the existing ones: what broke (multi-tenant schema gains
  `releases.tenant_slug`), the database action (regenerate + migrate, backfill
  first), and that single-tenant setups are unaffected.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Register `releases` as a scoped table in core

1. `packages/cms/src/core/types/definitions.ts` — in `ResolvedScope`, add
   `releases?: TableScope;` after `variables?: TableScope;`.
2. `packages/cms/src/core/endpoint.ts` — add `'releases'` to the `as const`
   table array in `computeScope`.

**Verify**: `bun run --filter=@createcms/core check-types` → exit 0.

### Step 2: Extend the multi-tenant plugin

1. `packages/cms/src/plugins/multi-tenant/schema.ts` — add a `releases` entry
   to `extend` with `tenantSlug` text NOT NULL and a `tenantIdx` on
   `['tenantSlug']` (copy the `templates` entry's shape).
2. `packages/cms/src/plugins/multi-tenant/index.ts` — in the scope factory's
   returned object, add:

   ```ts
   releases: {
     where: sql`"cms"."releases"."tenant_slug" = ${tenantSlug}`,
     insertColumns,
   },
   ```

**Verify**: `bun run --filter=@createcms/core check-types` → exit 0;
`cd packages/cms && bunx vitest run src/plugins/multi-tenant/test/multi-tenant.test.ts` → still passes (the test DB is generated through the codegen pipeline, so the new column appears automatically — see `test/utils/cms.ts`).

### Step 3: Apply the scope in `releases.ts`

Work endpoint by endpoint. `const { db } = cmsCtx;` stays; read
`ctx.context.scope` inside each handler.

1. **`assertItemExists`** — change the signature to
   `(db, rootId, branchId, rootScope: TableScope | undefined)` and replace the
   root lookup with a call to `requireRootInScope`-style logic: keep the
   collection-agnostic check (a release spans collections) but AND
   `rootScope?.where` and `isNull(roots.archivedAt)` into the root query
   (`and(eq(roots.id, rootId), isNull(roots.archivedAt), rootScope?.where)`).
   Update both callers (`addToRelease`, `setReleaseItems`) to pass
   `ctx.context.scope.roots`. Import `isNull` from `drizzle-orm` and
   `TableScope` from `'../types/definitions'` if not already imported.
2. **`assertDraftRelease`** — add a `releaseScope: TableScope | undefined`
   parameter and AND `releaseScope?.where` into the where clause. Update every
   caller to pass `ctx.context.scope.releases`. (If plan 006 has landed, this
   helper also takes `exec`/`forUpdate` — keep those.)
3. **`createRelease`** — replace the Drizzle insert with
   `scopedInsert(db, 'cms.releases', { title: ctx.body.title, created_by: ctx.context.userId ?? null }, ctx.context.scope.releases)`,
   then map the returned snake_case row to the camelCase shape the endpoint
   returned before (`id`, `title`, `status`, `createdBy`, `createdAt`,
   `publishedAt`). Look at how `variables.ts` maps its `scopedInsert` result
   and copy that.
4. **`getRelease`** — AND `ctx.context.scope.releases?.where` into the release
   query. Items need no extra filter (they are reachable only through an
   in-scope release).
5. **`listReleases`** — build `where = and(statusCondition, scope.releases?.where)`
   and apply it to both the page and count queries (`and()` drops `undefined`).
6. **`removeFromRelease`**, **`setReleaseItems`**, **`addToRelease`** — they
   call `assertDraftRelease`; nothing else needed once (2) is in place.
7. **`publishRelease`** — AND `scope.releases?.where` into the `.for('update')`
   release load so an out-of-scope id 404s before anything is locked.

**Verify**: `bun run --filter=@createcms/core check-types` → exit 0;
`cd packages/cms && bunx vitest run src/core/routes/test/releases.test.ts` → all pass (single-tenant: every predicate is `undefined`).

### Step 4: Isolation tests

In `packages/cms/src/plugins/multi-tenant/test/multi-tenant.test.ts`, add
`describe('multiTenant release isolation', ...)` using `setupMultiTenantTestCMS()`
and `setTenant`:

1. **listReleases is per tenant**: acme creates two releases, globex one;
   `setTenant('globex'); listReleases()` → `releases.length === 1`, `total === 1`.
2. **getRelease across tenants 404s**: acme creates a release; globex calls
   `getRelease({ query: { releaseId } })` → rejects with `RELEASE_NOT_FOUND`
   (use the same rejection-assertion style the file already uses).
3. **addToRelease rejects another tenant's root**: acme creates a root;
   globex creates a release and calls `addToRelease` with acme's `rootId`/`branchId`
   → rejects with `ROOT_NOT_FOUND`.
4. **setReleaseItems / removeFromRelease on another tenant's release 404**:
   acme creates a release; globex calls `setReleaseItems({ releaseId, items: [] })`
   → rejects with `RELEASE_NOT_FOUND`.
5. **publishRelease on another tenant's release 404s**.
6. **the stamped column**: after acme creates a release, select from the
   `releases` table via `db` and assert the raw row's `tenant_slug` (or the
   Drizzle column name the generated schema exposes) equals `'acme'`. Look at
   how the existing root-isolation tests read `tenantSlug` off rows and copy it.

**Verify**: `cd packages/cms && bunx vitest run src/plugins/multi-tenant/test/multi-tenant.test.ts` → all pass, 6 new.

### Step 5: Breaking-change bookkeeping and full verification

1. Add the `BREAKING-CHANGES.md` `## Unreleased` entry.
2. Create `.changeset/releases-scoped.md` (`minor`).
3. Run `node scripts/check-commit-message.mjs "feat(releases)!: scope releases by plugin scope"` → exit 0.

**Verify**: `bun run --filter=@createcms/core check-types && bun run lint && bunx oxfmt --check && node scripts/sync-changelog.mjs --check && bun run --filter=@createcms/core test` → all exit 0.

## Test plan

- Six new multi-tenant isolation tests (Step 4), modelled on
  `describe('multiTenant root isolation', ...)` in the same file.
- Existing `releases.test.ts` unchanged and green (proves single-tenant
  behaviour is intact).
- `endpoint-authz-contract.test.ts` must stay green (no metadata changes).

## Done criteria

- [ ] `grep -n "releases?: TableScope" packages/cms/src/core/types/definitions.ts` → 1 hit
- [ ] `grep -n "'releases'" packages/cms/src/core/endpoint.ts` → 1 hit in the `computeScope` array
- [ ] `grep -n "releases" packages/cms/src/plugins/multi-tenant/schema.ts packages/cms/src/plugins/multi-tenant/index.ts` → hits in both
- [ ] `grep -c "scope.releases" packages/cms/src/core/routes/releases.ts` → ≥ 5
- [ ] `grep -n "scopedInsert(db, 'cms.releases'" packages/cms/src/core/routes/releases.ts` → 1 hit
- [ ] Multi-tenant and releases test files pass; full suite exits 0
- [ ] `BREAKING-CHANGES.md` has a new `## Unreleased` bullet; `.changeset/releases-scoped.md` exists with `minor`
- [ ] `node scripts/check-commit-message.mjs "feat(releases)!: scope releases by plugin scope"` exits 0
- [ ] `git status` shows only in-scope files modified
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- `computeScope` no longer iterates a literal table list (the mechanism changed).
- `definePluginSchema`'s `extend` rejects a `releases` key (the core table is
  not in `CoreTables`) — report; do not add the column to core.
- `scopedInsert` cannot be used for `cms.releases` because the `status` column
  has an enum default that the raw INSERT does not apply — if the returned row
  lacks `status: 'draft'`, stop and report rather than hard-coding it in the
  insert values.
- An existing multi-tenant test fails because the test schema pipeline does
  not pick up the new `releases` extension.
- Any verification fails twice.

## Maintenance notes

- Consumers on multi-tenant must backfill `releases.tenant_slug` before the
  NOT NULL constraint applies; the BREAKING-CHANGES entry must say so. A
  reviewer should check that entry exists and names the column.
- `release_items` remain unscoped by column; their isolation relies on both
  the release (scoped) and the root (checked at add time). If a future
  endpoint ever lists release items without going through a release, it must
  filter by the release scope.
- Related, not fixed here (audit findings): comment threads with a null
  `rootId` bypass the scope check (`comments.ts:280-291, 708-712`);
  `admin.runPruning` runs globally regardless of the caller's scope
  (`admin.ts:69-86`); `users.listReviewers` returns the entire user table
  (`users.ts:123-149`); the A/B-test plugin keys its scoping on the literal
  `tenant_slug` insert column (`plugins/ab-test/endpoints.ts:85-87`). Each is
  a candidate for a follow-up plan.

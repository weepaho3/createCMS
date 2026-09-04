# Plan 002: Fire revalidation when scheduled publishes and releases go live

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b6a71a6..HEAD -- packages/cms/src/core/factory.ts packages/cms/src/core/routes/admin.ts packages/cms/src/core/routes/releases.ts packages/cms/src/core/admin/scheduling.ts packages/cms/src/core/revalidation.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (plan 005 touches `revalidation.ts` too; if both are
  executed, run 005 first or merge carefully — the two change different
  functions)
- **Category**: bug
- **Planned at**: commit `b6a71a6`, 2026-09-04

## Why this matters

`onRevalidate` is how a Next.js site learns that published content changed:
after `publishBranch`, `unpublishBranch`, `executeMerge` and block mutations,
the CMS computes the affected paths and calls the consumer's handler. That
wiring lives in the endpoint wrapper and only runs for actions in a fixed
`WRITE_ACTIONS` list.

Two paths make content live **without** going through those actions:
`admin.runScheduled` (cron-driven scheduled publish/unpublish) and
`releases.publishRelease` (atomic multi-page publish). Both call
`publishBranchInTx` / `unpublishBranchInTx` directly and never touch the
revalidation runner. Result: a page scheduled for Monday 09:00 goes live in
the database, but the site keeps serving the stale ISR render until the
route's TTL expires. There is no error and no log line.

After this plan, both paths fire the same revalidation events the manual
endpoints fire, after their transactions commit, best-effort (a handler
failure never un-publishes anything).

## Current state

Files:

- `packages/cms/src/core/revalidation.ts` — `createRevalidationRunner(db, config, collections)` returns a `RevalidationRunner` with `shouldProcess`, `preProcess`, `postProcess`, `fireManual`. `WRITE_ACTIONS` at lines 251-264 lists the actions the wrapper handles.
- `packages/cms/src/core/factory.ts` — wires everything. Relevant order today:
  - line ~733: `const adminEndpoints = createAdminEndpoints(cmsContext, plugins, definition.media);`
  - line ~742: `const revalidationRunner = revalidateConfig ? createRevalidationRunner(...) : null;`
  - line ~749: `createVariableEndpoints(cmsContext, revalidationRunner)` (the existing example of passing the runner into a route factory)
  - line ~756: `const releaseEndpoints = createReleaseEndpoints(cmsContext);`
  - line ~971: `const revalidate = revalidationRunner ? (opts) => revalidationRunner.fireManual(opts) : undefined;` (exposed as `cms.revalidate`)
- `packages/cms/src/core/routes/admin.ts` — `createAdminEndpoints(cmsCtx, plugins, mediaConfig)`; the `runScheduled` endpoint (line ~97) calls `runScheduledPass(db, cmsCtx, { limit }, ctx.context.scope)`.
- `packages/cms/src/core/admin/scheduling.ts` — `runScheduledPass(db, cmsCtx, opts, scope)`; `RunScheduledOptions` at lines 15-23; per-row transaction at line ~128; post-commit best-effort asset sync at lines ~186-203.
- `packages/cms/src/core/routes/releases.ts` — `createReleaseEndpoints(cmsCtx)`; `publishRelease` transaction at lines ~404-470, post-commit asset sync loop at lines ~471-477.
- `packages/cms/src/core/test/revalidation.test.ts` — exemplar: builds a CMS with `onRevalidate: (event) => events.push(event)` and asserts on the collected events.
- `packages/cms/src/core/routes/test/scheduled-publications.test.ts` and `packages/cms/src/core/routes/test/releases.test.ts` — exemplars for driving those endpoints via `setupTestCMS()`.

`fireManual` today (`revalidation.ts:644-660`):

```ts
async fireManual(opts) {
  const pub = await checkPublication(db, opts.rootId, opts.branchId);
  if (!pub) {
    debugLog(`manual revalidation for ... -> branch not published, skipping`);
    return;
  }
  await buildAndFire('publishBranch', opts.collection, opts.rootId, opts.branchId, pub.slug);
},
```

`RevalidationRunner` type (`revalidation.ts:266-292`) declares `shouldProcess`,
`preProcess`, `postProcess`, `fireManual(opts: { collection; rootId; branchId })`.

The unpublish path in `postProcess` (`revalidation.ts:519-535`) fires
`buildAndFire('unpublishBranch', collection, rootId, branchId, slug)` followed
by `cascadeRevalidation(action, collection, rootId)`, where `slug` was read
**before** the publication row was deleted (the slug comes from
`checkPublication`, which joins `cms.publications` to `cms.roots` and returns
`r.slug`).

Scheduled pass, post-commit section (`scheduling.ts:186-203`):

```ts
if (outcome.status === 'skipped') continue;
result.processed++;
if (outcome.status === 'published') {
  result.published++;
  await syncAssetsOnPublish(db, outcome.commitId, row.rootId).catch((err) =>
    console.error('[cms] scheduled publish asset sync failed:', err),
  );
} else {
  result.unpublished++;
  await syncAssetsOnUnpublish(db, outcome.commitId, row.rootId, row.branchId).catch(...);
}
```

Inside the transaction (`scheduling.ts:149-156`) the host collection name is
resolved as `rootRow.collection`. It is not returned from the transaction
today; you will need it post-commit.

Release publish, post-commit section (`releases.ts:471-477`):

```ts
// Post-commit, best-effort: the publications are already durable.
for (const s of synced) {
  await syncAssetsOnPublish(db, s.commitId, s.rootId).catch((err) =>
    console.error('[cms] release publish asset sync failed:', err),
  );
}
```

`synced` is `{ commitId, rootId }[]`. The `items` loop above it has
`item.rootId`, `item.branchId`, and resolves each root's collection (look for
the variable that holds `roots.collection` for the item — it is needed to
call `publishBranchInTx` with `collectionName`).

Convention: post-commit side effects are best-effort and logged with a
`[cms] ... failed:` prefix via `console.error` — match the two excerpts above.

## Commands you will need

| Purpose    | Command                                                                                                                                                           | Expected on success |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Install    | `bun install --frozen-lockfile`                                                                                                                                   | exit 0              |
| Typecheck  | `bun run --filter=@createcms/core check-types`                                                                                                                    | exit 0              |
| Tests      | `cd packages/cms && bunx vitest run src/core/test/revalidation.test.ts src/core/routes/test/scheduled-publications.test.ts src/core/routes/test/releases.test.ts` | all pass            |
| Full suite | `bun run --filter=@createcms/core test`                                                                                                                           | all pass            |
| Lint       | `bun run lint && bunx oxfmt --check`                                                                                                                              | exit 0              |

(From `CONTRIBUTING.md`; not executed by the advisor.)

## Scope

**In scope**:

- `packages/cms/src/core/revalidation.ts` — add `fireManualUnpublish` to the runner (type + implementation)
- `packages/cms/src/core/admin/scheduling.ts` — accept a runner and fire after commit
- `packages/cms/src/core/routes/admin.ts` — accept and pass the runner
- `packages/cms/src/core/routes/releases.ts` — accept the runner and fire after commit
- `packages/cms/src/core/factory.ts` — reorder so the runner exists before admin endpoints; pass it to admin and release factories
- `packages/cms/src/core/test/revalidation.test.ts` — new tests
- `.changeset/revalidate-scheduled-release.md` (create)

**Out of scope**:

- `packages/cms/src/core/endpoint.ts` — the wrapper's revalidation flow is a
  separate plan (005).
- `WRITE_ACTIONS` in `revalidation.ts` — do not add `runScheduled` /
  `publishRelease` there; the wrapper cannot derive per-root events from those
  endpoints' bodies, which is why the fix lives post-commit in the handlers.
- `packages/cms/src/core/publish/publish-branch.ts` — leave the transactional
  publish primitives untouched.
- Docs MDX.

## Git workflow

- Branch: `advisor/002-revalidate-scheduled-release`
- Commit: `fix(revalidation): fire events for scheduled and release publishes`
- Changeset `.changeset/revalidate-scheduled-release.md`:

  ```md
  ---
  '@createcms/core': patch
  ---

  `admin.runScheduled` and `releases.publishRelease` now fire `onRevalidate`
  events for every page they publish or unpublish, matching `publishBranch`
  and `unpublishBranch`.
  ```

- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add `fireManualUnpublish` to the runner

In `packages/cms/src/core/revalidation.ts`:

1. Extend the `RevalidationRunner` type (next to `fireManual`) with:

   ```ts
   /**
    * Fires the unpublish event for a page whose publication row is already
    * gone. `slug` must have been read before the row was deleted.
    */
   fireManualUnpublish(opts: {
     collection: string;
     rootId: string;
     branchId: string;
     slug: string | null;
   }): Promise<void>;
   ```

2. Implement it in the returned object, directly after `fireManual`, mirroring
   the unpublish branch of `postProcess`:

   ```ts
   async fireManualUnpublish(opts) {
     await buildAndFire('unpublishBranch', opts.collection, opts.rootId, opts.branchId, opts.slug);
     await cascadeRevalidation('unpublishBranch', opts.collection, opts.rootId);
   },
   ```

   Use the exact argument order `buildAndFire` and `cascadeRevalidation` take
   in the existing `postProcess` unpublish branch (lines ~519-535).

**Verify**: `bun run --filter=@createcms/core check-types` → exit 0.

### Step 2: Thread the runner into `runScheduledPass`

In `packages/cms/src/core/admin/scheduling.ts`:

1. Import the type: `import type { RevalidationRunner } from '../revalidation';`
2. Add to `RunScheduledOptions`:

   ```ts
   /** When set, each committed publish/unpublish fires its revalidation event. */
   revalidationRunner?: RevalidationRunner | null;
   ```

3. Inside the per-row transaction, return the collection name and (for
   unpublish) the pre-delete slug so the post-commit code can use them:
   - For the publish branch: `return { status: 'published' as const, commitId: res.commitId, collection: rootRow.collection };`
   - For the unpublish branch, **before** calling `unpublishBranchInTx`, read
     the live slug:

     ```ts
     const [pubRow] = await tx
       .select({ slug: roots.slug })
       .from(roots)
       .where(eq(roots.id, row.rootId));
     ```

     (`roots` and `eq` are already imported in this file.) Then
     `return { status: 'unpublished' as const, commitId: res.commitId, collection: rootRow.collection, slug: pubRow?.slug ?? null };`

4. In the post-commit section, after the existing asset-sync call in each
   branch, add a best-effort revalidation call:

   ```ts
   if (opts.revalidationRunner) {
     await opts.revalidationRunner
       .fireManual({
         collection: outcome.collection,
         rootId: row.rootId,
         branchId: row.branchId,
       })
       .catch((err) =>
         console.error('[cms] scheduled publish revalidation failed:', err),
       );
   }
   ```

   and for unpublish:

   ```ts
   if (opts.revalidationRunner) {
     await opts.revalidationRunner
       .fireManualUnpublish({
         collection: outcome.collection,
         rootId: row.rootId,
         branchId: row.branchId,
         slug: outcome.slug,
       })
       .catch((err) =>
         console.error('[cms] scheduled unpublish revalidation failed:', err),
       );
   }
   ```

**Verify**: `bun run --filter=@createcms/core check-types` → exit 0.

### Step 3: Pass the runner through `createAdminEndpoints`

In `packages/cms/src/core/routes/admin.ts`:

1. Add a fourth parameter `revalidationRunner: RevalidationRunner | null` to
   `createAdminEndpoints` (import the type from `'../revalidation'`).
2. In `runScheduled`, pass it: `runScheduledPass(db, cmsCtx, { limit: ctx.body?.limit, revalidationRunner }, ctx.context.scope)`.

In `packages/cms/src/core/factory.ts`:

1. Move the block that computes `revalidateConfig` and `revalidationRunner`
   (currently lines ~741-748) **above** the `createAdminEndpoints(...)` call
   (currently line ~733). Nothing between them depends on either, but confirm
   by reading the lines you move across.
2. Change the call to
   `createAdminEndpoints(cmsContext, plugins, definition.media, revalidationRunner)`.

**Verify**: `bun run --filter=@createcms/core check-types` → exit 0;
`grep -n "createAdminEndpoints(\|const revalidationRunner" packages/cms/src/core/factory.ts`
→ the `const revalidationRunner` line number is smaller than the
`createAdminEndpoints(` line number.

### Step 4: Fire from `publishRelease`

In `packages/cms/src/core/routes/releases.ts`:

1. Add a second parameter `revalidationRunner: RevalidationRunner | null = null`
   to `createReleaseEndpoints` (import the type from `'../revalidation'`).
2. In `publishRelease`, extend the `synced` entries to also carry `branchId`
   and `collection` (the values used in the `publishBranchInTx` call for that
   item — `item.branchId` and the resolved collection name).
3. After the existing post-commit asset-sync loop, add:

   ```ts
   if (revalidationRunner) {
     for (const s of synced) {
       await revalidationRunner
         .fireManual({
           collection: s.collection,
           rootId: s.rootId,
           branchId: s.branchId,
         })
         .catch((err) =>
           console.error('[cms] release publish revalidation failed:', err),
         );
     }
   }
   ```

4. In `factory.ts`, change `createReleaseEndpoints(cmsContext)` to
   `createReleaseEndpoints(cmsContext, revalidationRunner)`.

**Verify**: `bun run --filter=@createcms/core check-types` → exit 0.

### Step 5: Tests

Add to `packages/cms/src/core/test/revalidation.test.ts` a new
`describe('revalidation for scheduled and release publishes', ...)` using the
file's existing pattern (`setupTestDB`, `createCMS({ ..., onRevalidate: (e) => events.push(e) })`,
`allowAnonymous()`, `DUMMY_MEDIA_CONFIG`, `COLLECTIONS`), with:

1. **Scheduled publish fires**: create a root, call
   `cms.api.pages.schedulePublication({ body: { rootId, branchId, scheduledAt: new Date(Date.now() - 60_000) } })`,
   clear `events`, call `cms.api.admin.runScheduled({ body: {} })`, then
   assert `events.some((e) => e.action === 'publishBranch' && e.rootId === root.rootId)`.
   (Look at `scheduled-publications.test.ts:8-60` for the exact call shapes,
   and at the existing tests in `revalidation.test.ts` for how they publish —
   if `requireApprovalBeforePublish` is on by default in the test collections,
   replicate the approval steps those tests use before scheduling.)
2. **Scheduled unpublish fires**: publish a root (via the same steps the
   existing tests use), schedule an unpublish in the past, clear `events`, run
   `runScheduled`, assert an event with `action === 'unpublishBranch'` and the
   root id.
3. **Release publish fires one event per item**: create two roots, create a
   release, `addToRelease` both, clear `events`, `publishRelease`, assert two
   `publishBranch` events whose `rootId`s are the two roots (see
   `releases.test.ts:8-45` for the call shapes).
4. **A throwing handler does not fail the endpoint**: build the CMS with
   `onRevalidate: () => { throw new Error('boom'); }`, schedule and run; assert
   `runScheduled` resolves with `published === 1`.

**Verify**: `cd packages/cms && bunx vitest run src/core/test/revalidation.test.ts` → all pass, including 4 new.

### Step 6: Full verification and changeset

Create the changeset file from the Git workflow section.

**Verify**: `bun run --filter=@createcms/core check-types && bun run lint && bunx oxfmt --check && bun run --filter=@createcms/core test` → all exit 0.

## Test plan

- Four new tests in `packages/cms/src/core/test/revalidation.test.ts` (Step 5),
  modelled on the existing tests in that file.
- Existing `scheduled-publications.test.ts` and `releases.test.ts` must keep
  passing unchanged (they build the CMS without `onRevalidate`, so the runner
  is `null` and the new code is a no-op there).

## Done criteria

- [ ] `bun run --filter=@createcms/core check-types` exits 0
- [ ] `grep -n "fireManualUnpublish" packages/cms/src/core/revalidation.ts packages/cms/src/core/admin/scheduling.ts` → at least one hit in each file
- [ ] `grep -n "revalidationRunner" packages/cms/src/core/routes/admin.ts packages/cms/src/core/routes/releases.ts` → hits in both files
- [ ] `cd packages/cms && bunx vitest run src/core/test/revalidation.test.ts` → all pass, 4 new tests present
- [ ] `bun run --filter=@createcms/core test` exits 0
- [ ] `bun run lint && bunx oxfmt --check` exit 0
- [ ] `.changeset/revalidate-scheduled-release.md` exists
- [ ] `git status` shows only in-scope files modified
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- `createAdminEndpoints` or `createReleaseEndpoints` already accept a
  revalidation runner (someone fixed this independently) — report and mark the
  plan DONE/REJECTED accordingly.
- Moving the runner construction above `createAdminEndpoints` in `factory.ts`
  would move it across code that the runner depends on (e.g. `cmsContext.collections`
  not yet populated) — report instead of restructuring the factory.
- The `roots` table has no `slug` column in `schema.generated.ts` (grep
  `slug:` inside `export const roots`).
- Test 4 (throwing handler) fails because the endpoint rejects — that means
  the `.catch` is missing or `fireEvent`'s own try/catch changed; fix the
  catch, and if it still fails, stop.
- Any verification fails twice.

## Maintenance notes

- Any future code path that calls `publishBranchInTx` / `unpublishBranchInTx`
  directly (outside the wrapped `publishBranch` / `unpublishBranch` endpoints)
  must fire revalidation post-commit the same way. A reviewer should grep for
  those two functions when reviewing new publish surfaces.
- The unpublish slug must be captured **inside** the transaction before the
  publication row is deleted; reading it afterwards returns `null` and the
  event carries no path.
- Deferred: a single `withPublishSideEffects(db, ...)` helper that bundles
  asset sync + revalidation for all three call sites would remove the
  duplication introduced here; do it once a third caller appears.

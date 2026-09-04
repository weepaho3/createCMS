# Plan 005: Keep a committed mutation from failing when post-commit revalidation throws, and stop the pre-resolved-slug leak

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b6a71a6..HEAD -- packages/cms/src/core/endpoint.ts packages/cms/src/core/revalidation.ts packages/cms/src/core/test/revalidation.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plan 002 also edits `revalidation.ts`; the two touch different functions — `fireManual*` vs `preProcess`/`postProcess` — land this one first)
- **Category**: bug
- **Planned at**: commit `b6a71a6`, 2026-09-04

## Why this matters

In the endpoint wrapper, the mutation handler runs and commits, and only then
does the revalidation runner's `postProcess` run: it issues several database
queries (publication lookup, redirect-path lookup, descendant and referencing
root cascades) before calling the consumer's handler. The consumer handler is
wrapped in try/catch; the queries are not. A slow or failing query there turns
a write that **already committed** into an HTTP 500. Clients retry, and the
editor's save path treats the response as a failure, so users see an error for
a save that succeeded and may create duplicate commits on retry.

Separately, `preProcess` parks the pre-delete slug for `unpublishBranch` in a
process-lifetime `Map` that only `postProcess` clears. If the handler throws
(for example `PUBLICATION_NOT_FOUND`), the entry is never removed. The map
grows monotonically on a long-running server, keyed by client-supplied ids.

After this plan, both revalidation phases are best-effort (logged, never
thrown to the client), and the pre-resolved slug travels through the call
instead of shared state, so there is nothing to leak.

## Current state

Files:

- `packages/cms/src/core/endpoint.ts` — `toCMSEndpoints(...)` builds
  `wrappedHandler`; the revalidation calls are at lines ~295-301 (pre) and
  ~367-374 (post).
- `packages/cms/src/core/revalidation.ts` — `RevalidationRunner` type (lines
  ~266-292); `createRevalidationRunner` (line 294) declares
  `const preResolvedSlugs = new Map<string, string | null>()` (line 301);
  `preProcess` (lines ~467-481); `postProcess` (lines ~483-642).
- `packages/cms/src/core/hooks.ts` — `runAfter` already wraps each hook in
  try/catch and logs `[cms] after-hook failed for ...` (lines 56-66). Match
  that logging style.
- `packages/cms/src/core/test/revalidation.test.ts` — exemplar for tests that
  build a CMS with `onRevalidate`.
- `packages/cms/src/core/routes/test/endpoint-authz-contract.test.ts` — shows
  that `cms.api.<ns>.<endpoint>` exposes `options.metadata`; not needed to
  modify.

Wrapper excerpts (`endpoint.ts`):

```ts
// lines ~295-301
if (revalidationRunner && revalidationRunner.shouldProcess(endpointKey)) {
  await revalidationRunner.preProcess(
    endpointKey,
    meta.collection ?? '',
    (body ?? {}) as Record<string, unknown>,
  );
}
...
const result = await ep(enrichedCtx);
...
// lines ~367-374
if (revalidationRunner && revalidationRunner.shouldProcess(endpointKey)) {
  await revalidationRunner.postProcess(
    endpointKey,
    meta.collection ?? '',
    (body ?? {}) as Record<string, unknown>,
    result,
  );
}
return finalResult;
```

Runner excerpts (`revalidation.ts`):

```ts
// type, lines ~272-286
preProcess(action: string, collection: string, input: Record<string, unknown>): Promise<void>;
postProcess(action: string, collection: string, input: Record<string, unknown>, result: unknown): Promise<void>;

// line 301
const preResolvedSlugs = new Map<string, string | null>();

// lines ~467-481
async preProcess(action, _collection, input) {
  if (action !== 'unpublishBranch') return;
  const rootId = input.rootId as string;
  const branchId = input.branchId as string;
  if (rootId && branchId) {
    const pub = await checkPublication(db, rootId, branchId);
    preResolvedSlugs.set(`${rootId}:${branchId}`, pub?.slug ?? null);
  }
},

// lines ~519-535 (inside postProcess)
if (action === 'unpublishBranch') {
  const rootId = input.rootId as string;
  const branchId = input.branchId as string;
  if (rootId && branchId) {
    const key = `${rootId}:${branchId}`;
    const slug = preResolvedSlugs.get(key) ?? null;
    preResolvedSlugs.delete(key);
    await buildAndFire(action, collection, rootId, branchId, slug);
    await cascadeRevalidation(action, collection, rootId);
  }
  return;
}
```

`fireEvent` (lines ~312-321) already catches handler errors and logs
`[cms:revalidate] handler error:`.

Convention: error logs use a bracketed prefix (`[cms:revalidate] ...`,
`[cms] after-hook failed ...`) and `console.error`.

## Commands you will need

| Purpose    | Command                                                                     | Expected on success |
| ---------- | --------------------------------------------------------------------------- | ------------------- |
| Install    | `bun install --frozen-lockfile`                                             | exit 0              |
| Typecheck  | `bun run --filter=@createcms/core check-types`                              | exit 0              |
| Tests      | `cd packages/cms && bunx vitest run src/core/test/revalidation.test.ts`     | all pass            |
| Full suite | `bun run --filter=@createcms/core test`                                     | all pass            |
| Lint       | `bun run lint && bunx oxfmt --check`                                        | exit 0              |

(From `CONTRIBUTING.md`; not executed by the advisor.)

## Scope

**In scope**:

- `packages/cms/src/core/endpoint.ts` — the two revalidation call sites only
- `packages/cms/src/core/revalidation.ts` — `RevalidationRunner` type, `preResolvedSlugs`, `preProcess`, `postProcess` unpublish branch
- `packages/cms/src/core/test/revalidation.test.ts` — new tests
- `.changeset/revalidation-best-effort.md` (create)

**Out of scope**:

- `hookRunner.runAfter` — already isolates per-hook failures.
- `fireManual` / `fireManualUnpublish` (plan 002).
- The cascade queries' cost/fan-out (audit finding PERF-05) — do not add
  concurrency limits here.
- Any change to what paths get revalidated.

## Git workflow

- Branch: `advisor/005-revalidation-best-effort`
- Commit: `fix(revalidation): never fail a committed mutation on post-process errors`
- Changeset `.changeset/revalidation-best-effort.md`:

  ```md
  ---
  '@createcms/core': patch
  ---

  Revalidation pre/post-processing failures are logged and no longer turn a
  committed mutation into an error response. The pre-resolved unpublish slug
  is passed through the call instead of a process-lifetime map.
  ```

- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Pass the pre-state through instead of a shared map

In `packages/cms/src/core/revalidation.ts`:

1. Change the `RevalidationRunner` type:
   - `preProcess(...)` returns `Promise<unknown>` (an opaque pre-state, or `undefined`).
   - `postProcess(action, collection, input, result, preState?: unknown)`.
2. Delete `const preResolvedSlugs = new Map<string, string | null>();`.
3. `preProcess`: instead of `preResolvedSlugs.set(...)`, `return pub?.slug ?? null;`
   (return `undefined` when the action is not `unpublishBranch` or ids are
   missing).
4. `postProcess` unpublish branch: replace the map get/delete with
   `const slug = typeof preState === 'string' ? preState : null;`.

**Verify**: `grep -n "preResolvedSlugs" packages/cms/src/core/revalidation.ts` → no matches; `bun run --filter=@createcms/core check-types` → errors only in `endpoint.ts` (fixed in Step 2).

### Step 2: Make both wrapper call sites best-effort

In `packages/cms/src/core/endpoint.ts`:

1. Replace the pre-process block with:

   ```ts
   let revalidatePreState: unknown;
   if (revalidationRunner && revalidationRunner.shouldProcess(endpointKey)) {
     try {
       revalidatePreState = await revalidationRunner.preProcess(
         endpointKey,
         meta.collection ?? '',
         (body ?? {}) as Record<string, unknown>,
       );
     } catch (err) {
       console.error(`[cms:revalidate] preProcess failed for ${endpointKey}:`, err);
     }
   }
   ```

2. Replace the post-process block with:

   ```ts
   if (revalidationRunner && revalidationRunner.shouldProcess(endpointKey)) {
     try {
       await revalidationRunner.postProcess(
         endpointKey,
         meta.collection ?? '',
         (body ?? {}) as Record<string, unknown>,
         result,
         revalidatePreState,
       );
     } catch (err) {
       console.error(`[cms:revalidate] postProcess failed for ${endpointKey}:`, err);
     }
   }
   ```

**Verify**: `bun run --filter=@createcms/core check-types` → exit 0;
`cd packages/cms && bunx vitest run src/core/test/revalidation.test.ts` → existing tests pass (unpublish events still carry the slug).

### Step 3: Tests

Add to `packages/cms/src/core/test/revalidation.test.ts` a
`describe('revalidation is best-effort', ...)` using the file's existing
setup pattern:

1. **unpublish still carries the slug through the new pre-state path**: if an
   existing test already asserts the `unpublishBranch` event's path/slug, it
   covers this — note which one in a comment; otherwise add: publish a root,
   clear `events`, `unpublishBranch`, assert the event's `storedSlug` (or the
   path field the existing tests assert on) is the published slug.
2. **a failing postProcess query does not fail the endpoint**: build the CMS
   with `onRevalidate: () => {}`. After publishing, make the post-process
   query fail by dropping a table the cascade reads, e.g.
   `await db.execute(sql\`DROP TABLE cms.redirects CASCADE\`)` — check
   `subtreeInboundRedirectPaths` in `revalidation.ts` reads `cms.redirects`
   first. Then call `unpublishBranch` (or `publishBranch` of a second root)
   and assert it **resolves**. If dropping that table also breaks the
   endpoint's own handler, pick a table only the cascade reads (grep the
   cascade helpers in `revalidation.ts` for `FROM cms.` to choose).
   Use a fresh `setupTestDB` for this case so the dropped table does not
   affect other tests (the file already takes a `cleanup` per test).
3. **preProcess failure does not block the handler**: same setup, drop the
   table before `unpublishBranch`; assert the call resolves and the
   publication row is gone.

If (2) and (3) prove impossible to induce without breaking the handler under
test, replace them with a unit test that calls `toCMSEndpoints` directly with
a stub runner: `{ shouldProcess: () => true, preProcess: async () => { throw new Error('pre'); }, postProcess: async () => { throw new Error('post'); }, fireManual: async () => {} }`
and a minimal endpoint created with `createCMSEndpoint` + `cmsMeta`, asserting
the wrapped handler resolves with the endpoint's result. `toCMSEndpoints`,
`createCMSEndpoint`, and `cmsMeta` are exported from `core/endpoint.ts`; a
`HookRunner` can be built with `createHookRunner([], [])` from `core/hooks.ts`
(check its signature).

**Verify**: `cd packages/cms && bunx vitest run src/core/test/revalidation.test.ts` → all pass, with the new cases.

### Step 4: Full verification and changeset

Create the changeset from the Git workflow section.

**Verify**: `bun run --filter=@createcms/core check-types && bun run lint && bunx oxfmt --check && bun run --filter=@createcms/core test` → all exit 0.

## Test plan

- Two or three new tests in `revalidation.test.ts` (Step 3), modelled on the
  existing tests in that file (or the `toCMSEndpoints` unit variant).
- All existing revalidation tests unchanged and green.

## Done criteria

- [ ] `grep -n "preResolvedSlugs" packages/cms/src/core/revalidation.ts` → no matches
- [ ] `grep -c "\[cms:revalidate\] \(pre\|post\)Process failed" packages/cms/src/core/endpoint.ts` → 2
- [ ] `cd packages/cms && bunx vitest run src/core/test/revalidation.test.ts` → all pass with new tests
- [ ] `bun run --filter=@createcms/core check-types`, `bun run lint`, `bunx oxfmt --check`, `bun run --filter=@createcms/core test` exit 0
- [ ] `.changeset/revalidation-best-effort.md` exists
- [ ] `git status` shows only in-scope files modified
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- `endpoint.ts` no longer calls `preProcess`/`postProcess` at the shown sites
  (the wrapper was restructured).
- `RevalidationRunner` is implemented anywhere other than
  `createRevalidationRunner` (grep `postProcess(` across `packages/cms/src`);
  each implementation would need the signature change.
- Any verification fails twice.

## Maintenance notes

- Post-commit side effects in this codebase are best-effort by contract
  (notifications, search hooks, asset sync). Revalidation now matches. A
  reviewer should confirm no new `await` was added between `ep(enrichedCtx)`
  and `return finalResult` without a try/catch.
- The pre-state is opaque (`unknown`) so future actions can pre-resolve other
  data without widening the map pattern again.
- Deferred: bounding the cascade fan-out (PERF-05) and moving revalidation
  off the request path entirely.

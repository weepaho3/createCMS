# Plan 001: Make the search index follow merges, publishes, root duplication and branch reverts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b6a71a6..HEAD -- packages/cms/src/core/search/hooks.ts packages/cms/src/core/search/test/search-hooks.test.ts packages/cms/src/core/routes/branches.ts packages/cms/src/core/routes/merges.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `b6a71a6`, 2026-09-04

## Why this matters

The search index is kept in sync by "after-hooks" that fire once an endpoint
has committed. The hook registered for `executeMerge` reads the root id from
the request **body**, but `executeMerge`'s body only carries
`mergeRequestId` (plus optional `mergedBy`, `message`, `noFastForward`). The
extractor returns `undefined`, the hook returns early, and merging a branch
into `main` — the primary way content reaches the default branch — never
re-indexes the root. Search keeps showing pre-merge content until some
unrelated block edit on the same root happens to trigger indexing.

Three more mutations that change indexed data have no hook at all:
`publishBranch` (materializes `roots.slug`, which `indexRoot` stores as the
entry's slug), `duplicateRoot` (creates a brand-new root that is never
indexed), and `revertBranch` (rewrites the default branch's content).

After this plan, all four actions re-index the affected root, and a unit test
pins each extractor so a future body/result reshape cannot silently break
them again.

## Current state

Files:

- `packages/cms/src/core/search/hooks.ts` — builds the list of search
  after-hooks. `createSearchHooks(defaultBranchName)` returns `CMSAfterHook[]`.
- `packages/cms/src/core/search/test/search-hooks.test.ts` — unit test for the
  hook extractors (mocks `../index-builder`). Pattern to extend.
- `packages/cms/src/core/routes/merges.ts` — `executeMerge` endpoint
  (body schema at ~line 1493; result at ~line 1751).
- `packages/cms/src/core/routes/branches.ts` — `revertBranch` endpoint
  (~line 679; result at ~line 790).
- `packages/cms/src/core/routes/blocks-root-endpoints.ts` — `duplicateRoot`
  endpoint (~line 559); its result comes from `runDuplicate` in
  `routes/blocks-context.ts` (~line 262) and carries `rootId: newRoot.id`.
- `packages/cms/src/core/revalidation.ts` — shows the correct way to read the
  merge root id (from the **result**), lines ~538-548.

The extractors and hook list as they exist today
(`packages/cms/src/core/search/hooks.ts:61-86`):

```ts
const resultRootId = (_input: Record<string, unknown>, result: unknown) =>
  (result as { rootId?: string })?.rootId;

const inputRootId = (input: Record<string, unknown>) =>
  input.rootId as string | undefined;

export function createSearchHooks(defaultBranchName: string): CMSAfterHook[] {
  const indexRootFn: IndexFn = (db, id) => indexRoot(db, id, defaultBranchName);
  return [
    createSearchAfterHook('createRoot', resultRootId, indexRootFn),
    createSearchAfterHook('updateRoot', inputRootId, indexRootFn),
    createSearchAfterHook('updateBlock', inputRootId, indexRootFn),
    createSearchAfterHook('updateBlocks', inputRootId, indexRootFn),
    createSearchAfterHook('createBlock', inputRootId, indexRootFn),
    createSearchAfterHook('deleteBlock', inputRootId, indexRootFn),
    createSearchAfterHook('moveBlock', inputRootId, indexRootFn),
    createSearchAfterHook('duplicateBlock', inputRootId, indexRootFn),
    createSearchAfterHook('moveRoot', inputRootId, indexRootFn),
    createSearchAfterHook('executeMerge', inputRootId, indexRootFn),   // <-- BUG
    // Archiving a root removes it from the working set, so drop its entry.
    createDeleteAfterHook('archiveRoot', 'root', inputRootId),
    ...
```

`executeMerge`'s body schema (`packages/cms/src/core/routes/merges.ts:1493-1498`)
has no `rootId`:

```ts
body: z.object({
  mergeRequestId: z.string(),
  mergedBy: z.string().optional(),
  message: z.string().optional(),
  noFastForward: z.boolean().optional(),
}),
```

`executeMerge`'s result (`packages/cms/src/core/routes/merges.ts:1751-1755`)
does carry `rootId: mr.rootId` and `targetBranchId: mr.targetBranchId`.
`packages/cms/src/core/revalidation.ts:538-548` already reads it from there:

```ts
// executeMerge exposes rootId and targetBranchId in its result, so read
// them directly; only the publication check query is needed.
if (action === 'executeMerge') {
  const mergeResult = result as { rootId?: string; targetBranchId?: string } | null;
```

`revertBranch`'s body (`packages/cms/src/core/routes/branches.ts:683-688`) has
`branchId`, `targetCommitId`, `message?`, `createdBy?` — no `rootId`. Its
result (`branches.ts:790-797`) is `{ commit: { id, message, createdAt,
createdBy } }` — also no `rootId`. Inside the handler the branch row is loaded
and `branch.rootId` is available (it is used at `branches.ts:~750-770`).

`publishBranch`'s body (`packages/cms/src/core/routes/publications.ts:166-167`)
has `rootId` and `branchId`.

`duplicateRoot`'s result (`packages/cms/src/core/routes/blocks-context.ts:265-272`):

```ts
return {
  mode: 'root' as const,
  commit,
  rootId: newRoot.id,
  branchId,
  slug: dupSlug ?? undefined,
  path: undefined as string | undefined,
};
```

Existing test pattern (`packages/cms/src/core/search/test/search-hooks.test.ts`):
the file mocks `../index-builder` with `vi.mock`, calls
`createSearchHooks('main')`, finds a hook by action, invokes
`hook.handler({ db, input, result })`, and asserts on the mocked index
function. Copy that shape exactly.

Conventions to honour:

- Comments must state checkable facts (recent commit "chore: prune comments to
  checkable facts"). Do not write narrative comments.
- The after-hook `action` type is `CMSHookAction = CMSEndpointKey | (string & {})`,
  so a typo in an action name is NOT a compile error. Copy action names
  character-for-character from the endpoint keys: `executeMerge`,
  `publishBranch`, `duplicateRoot`, `revertBranch`.

## Commands you will need

| Purpose    | Command                                                                              | Expected on success       |
| ---------- | ------------------------------------------------------------------------------------ | ------------------------- |
| Install    | `bun install --frozen-lockfile`                                                      | exit 0                    |
| Typecheck  | `bun run --filter=@createcms/core check-types`                                       | exit 0, no errors         |
| Unit test  | `cd packages/cms && bunx vitest run src/core/search/test/search-hooks.test.ts`       | all pass                  |
| Route test | `cd packages/cms && bunx vitest run src/core/routes/test/branches.test.ts`           | all pass                  |
| Full suite | `bun run --filter=@createcms/core test`                                              | all pass                  |
| Lint       | `bun run lint`                                                                       | exit 0                    |
| Format     | `bunx oxfmt --check`                                                                 | exit 0                    |

These commands come from `CONTRIBUTING.md` and `packages/cms/package.json`.
They were not executed by the advisor (no `node_modules` in the advisor's
sandbox); run `bun install --frozen-lockfile` first.

## Scope

**In scope** (the only files you should modify):

- `packages/cms/src/core/search/hooks.ts`
- `packages/cms/src/core/search/test/search-hooks.test.ts`
- `packages/cms/src/core/routes/branches.ts` — only to add `rootId` to
  `revertBranch`'s return value
- `packages/cms/src/core/routes/test/branches.test.ts` — one assertion on the
  new `rootId` field
- `.changeset/search-hooks-merge-publish.md` (create)

**Out of scope** (do NOT touch):

- `packages/cms/src/core/search/index-builder.ts` — indexing logic itself is
  correct; do not debounce or restructure it here.
- `packages/cms/src/core/revalidation.ts` — a separate concern.
- `packages/cms/src/core/routes/merges.ts` and
  `packages/cms/src/core/routes/blocks-root-endpoints.ts` — read only; their
  results already carry `rootId`.
- Any docs MDX — `revertBranch` gaining a `rootId` field is additive; if the
  docs-endpoints test complains about the response shape, STOP and report.

## Git workflow

- Branch: `advisor/001-search-hooks` (or the operator's assigned branch).
- Commit message (Conventional Commits, matches `git log`):
  `fix(search): reindex on merge, publish, duplicateRoot and revertBranch`
- Add a changeset file (the repo requires one per user-visible change):

  ```md
  ---
  '@createcms/core': patch
  ---

  Search index now updates after `executeMerge`, `publishBranch`,
  `duplicateRoot` and `revertBranch`. `revertBranch` additionally returns
  `rootId`.
  ```

- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fix the `executeMerge` extractor

In `packages/cms/src/core/search/hooks.ts`, change

```ts
createSearchAfterHook('executeMerge', inputRootId, indexRootFn),
```

to

```ts
createSearchAfterHook('executeMerge', resultRootId, indexRootFn),
```

**Verify**: `grep -n "executeMerge" packages/cms/src/core/search/hooks.ts`
→ exactly one line, containing `resultRootId`.

### Step 2: Add hooks for `publishBranch` and `duplicateRoot`

In the same array, directly after the `executeMerge` line, add:

```ts
// publishBranch materializes roots.slug, which indexRoot stores in the entry.
createSearchAfterHook('publishBranch', inputRootId, indexRootFn),
// duplicateRoot mints a new root; its id is only in the result.
createSearchAfterHook('duplicateRoot', resultRootId, indexRootFn),
```

**Verify**: `cd packages/cms && bunx vitest run src/core/search/test/search-hooks.test.ts`
→ existing 3 tests still pass.

### Step 3: Expose `rootId` from `revertBranch` and hook it

In `packages/cms/src/core/routes/branches.ts`, in the `revertBranch` handler,
find the return statement (currently around line 790):

```ts
return {
  commit: {
    id: newCommit.id,
    message: newCommit.message,
    createdAt: newCommit.createdAt,
    createdBy: newCommit.createdBy,
  },
};
```

Add `rootId: branch.rootId,` as the first property of the returned object.
`branch` is the row loaded (and locked) earlier in the same handler; if the
local variable holding the locked branch row is named differently, use that
name — do not add a second query.

Also update the JSDoc `@returns` line above the endpoint to mention `rootId`.

Then in `packages/cms/src/core/search/hooks.ts` add, after the
`duplicateRoot` hook:

```ts
// revertBranch's body has only branchId; the handler returns rootId.
createSearchAfterHook('revertBranch', resultRootId, indexRootFn),
```

**Verify**: `bun run --filter=@createcms/core check-types` → exit 0.

### Step 4: Pin the extractors in the unit test

Append to `packages/cms/src/core/search/test/search-hooks.test.ts` a new
`describe('search after-hooks cover merge, publish, duplicateRoot, revertBranch', ...)`
with these cases (import `indexRoot` from `'../index-builder'` alongside the
existing imports; it is already mocked by the `vi.mock` at the top):

1. `executeMerge` indexes `result.rootId`:
   `await fire('executeMerge', { mergeRequestId: 'mr_1' }, { rootId: 'root_1', targetBranchId: 'b_1' })`
   → `expect(indexRoot).toHaveBeenCalledWith(db, 'root_1')`.
2. `executeMerge` does NOT index when the result has no rootId (regression
   guard for the old input-based read):
   `await fire('executeMerge', { rootId: 'root_x', mergeRequestId: 'mr_1' }, {})`
   → `expect(indexRoot).not.toHaveBeenCalled()`.
3. `publishBranch` indexes `input.rootId`.
4. `duplicateRoot` indexes `result.rootId` (result shape
   `{ mode: 'root', rootId: 'root_new', branchId: 'b', commit: { id: 'c' } }`).
5. `revertBranch` indexes `result.rootId` (result shape
   `{ rootId: 'root_1', commit: { id: 'c' } }`).

Use the existing `fire`/`hookFor` helpers and `beforeEach(() => vi.clearAllMocks())`.

**Verify**: `cd packages/cms && bunx vitest run src/core/search/test/search-hooks.test.ts`
→ 8 tests pass (3 existing + 5 new).

### Step 5: Assert the new `revertBranch` field in the route test

In `packages/cms/src/core/routes/test/branches.test.ts`, locate an existing
`revertBranch` test (search for `revertBranch(`). In that test, after the
call, add `expect(result.rootId).toBe(<the root id used in that test>)`
using whatever variable the test already holds for the root.

**Verify**: `cd packages/cms && bunx vitest run src/core/routes/test/branches.test.ts` → all pass.

### Step 6: Full verification and changeset

Create `.changeset/search-hooks-merge-publish.md` with the content from the
Git workflow section.

**Verify**: `bun run --filter=@createcms/core check-types && bun run lint && bunx oxfmt --check && bun run --filter=@createcms/core test` → all exit 0.
(`bun run --filter=@createcms/core test` runs the docs-coverage tests too; if
`docs-endpoints.test.ts` fails on `revertBranch`, see STOP conditions.)

## Test plan

- New unit tests (Step 4) in `search-hooks.test.ts`: five cases listed above,
  modelled on the existing `describe` block in that file.
- One added assertion in `branches.test.ts` (Step 5).
- Verification: `cd packages/cms && bunx vitest run src/core/search src/core/routes/test/branches.test.ts` → all pass.

## Done criteria

ALL must hold:

- [ ] `bun run --filter=@createcms/core check-types` exits 0
- [ ] `cd packages/cms && bunx vitest run src/core/search/test/search-hooks.test.ts` → 8 passing
- [ ] `grep -c "createSearchAfterHook('\(executeMerge\|publishBranch\|duplicateRoot\|revertBranch\)', resultRootId\|createSearchAfterHook('publishBranch', inputRootId" packages/cms/src/core/search/hooks.ts` → 4
- [ ] `grep -n "'executeMerge', inputRootId" packages/cms/src/core/search/hooks.ts` → no matches
- [ ] `bun run --filter=@createcms/core test` exits 0
- [ ] `bun run lint` and `bunx oxfmt --check` exit 0
- [ ] `.changeset/search-hooks-merge-publish.md` exists
- [ ] `git status` shows only in-scope files modified
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `packages/cms/src/core/search/hooks.ts` no longer contains
  `createSearchAfterHook('executeMerge', inputRootId, indexRootFn)`.
- `executeMerge`'s result in `merges.ts` no longer contains `rootId` (grep
  `rootId: mr.rootId` near line 1754).
- `revertBranch`'s handler does not have a loaded branch row with `rootId`
  available at the return site.
- A docs-coverage test (`src/**/docs-*.test.ts`) fails because of the added
  `rootId` field — the response-shape docs may need an update that is out of
  this plan's scope.
- Any verification fails twice after a reasonable fix attempt.

## Maintenance notes

- The hook list is typed with the open `CMSHookAction` union, so a renamed
  endpoint will not break the build; the unit test in Step 4 is the only
  guard. When adding a mutation that changes a root's default-branch content
  or slug, add both the hook and a test case.
- `indexRoot` always indexes the default branch head (`index-builder.ts:134`),
  so a `publishBranch` of a non-default branch re-indexes `main`'s content
  with the new slug. That is the current contract; a per-branch index is a
  separate design decision.
- Deferred (not in this plan): coalescing per-keystroke reindexes and skipping
  reindex for non-default branches (audit finding PERF-02), and giving
  `fireAndForget` a flush seam like the notification service (BUG-12).

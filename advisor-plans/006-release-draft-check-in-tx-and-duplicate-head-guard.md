# Plan 006: Lock the release row when checking draft status, and give `duplicateBlock` the optimistic-concurrency guard every other mutation has

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `advisor-plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat b6a71a6..HEAD -- packages/cms/src/core/routes/releases.ts packages/cms/src/core/routes/blocks-context.ts packages/cms/src/core/routes/blocks-block-endpoints.ts packages/cms/src/core/routes/test/releases.test.ts packages/cms/src/core/routes/test/blocks.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (plan 004 edits `releases.ts` too; land this first)
- **Category**: bug
- **Planned at**: commit `b6a71a6`, 2026-09-04

## Why this matters

Two small check-then-act gaps.

**Releases.** `addToRelease`, `removeFromRelease` and `setReleaseItems` check
`status === 'draft'` with a plain `SELECT` on `db` **before** opening their
transaction, while `publishRelease` locks the release row `FOR UPDATE` and
flips it to `published`. A `setReleaseItems` that passes the check just before
`publishRelease` commits then deletes-and-reinserts `release_items` on a
release that is already `published`. The release's recorded item list no
longer matches what was published, and a re-publish is refused with
`RELEASE_NOT_DRAFT`.

**duplicateBlock.** Every other content mutation (`moveBlock`, `deleteBlock`,
`updateBlocks`, create/update via the schema builders) accepts an optional
`expectedHeadCommitId` and rejects with `HEAD_MISMATCH` when the branch has
advanced. `duplicateBlock`'s body has no such field and its `writeCommit`
call omits it, so a client that consistently sends the guard (the editor's
`useCmsDocument` does) gets silent last-write-wins on duplicate: a concurrent
commit's parent edit is overwritten.

After this plan, the draft check runs inside the transaction under a row lock
for all three item-mutating release endpoints, and `duplicateBlock` accepts
and enforces `expectedHeadCommitId`.

## Current state

Files:

- `packages/cms/src/core/routes/releases.ts` — `assertDraftRelease(db, releaseId)` (lines ~492-503); callers at ~146 (`addToRelease`), ~183 (`removeFromRelease`), ~231 (`setReleaseItems`); `setReleaseItems` opens `db.transaction` at ~247; `publishRelease` locks at ~404-409.
- `packages/cms/src/core/routes/blocks-context.ts` — `DuplicateInput` type (lines ~140-153); `runDuplicate` (line ~155) locks the branch via `lockWritableBranch` and reads `oldHeadId` (line ~169); the child-mode `writeCommit` call at lines ~315-322 has no `expectedHeadCommitId`.
- `packages/cms/src/core/routes/blocks-block-endpoints.ts` — `duplicateBlock` body schema (lines ~898-907) and `$Infer` block (~911-920); `moveBlock` body (~555-563) shows the field to copy.
- `packages/cms/src/core/blocks/commit-writer.ts` — `writeCommit` accepts `expectedHeadCommitId?: string` and throws `HEAD_MISMATCH` when it differs from `parentCommitId` (lines 68-92).
- `packages/cms/src/core/routes/test/releases.test.ts` — release tests via `setupTestCMS()`.
- `packages/cms/src/core/routes/test/blocks.test.ts` — `describe('optimistic concurrency (expectedHeadCommitId)', ...)` at line ~2281 is the exact pattern for the new duplicate test.

`assertDraftRelease` today (`releases.ts:492-503`):

```ts
async function assertDraftRelease(db: DrizzleInstance, releaseId: string): Promise<void> {
  const [release] = await db
    .select({ status: releases.status })
    .from(releases)
    .where(eq(releases.id, releaseId));
  if (!release) throw RELEASE_NOT_FOUND();
  if (release.status !== 'draft') throw RELEASE_NOT_DRAFT();
}
```

`setReleaseItems` handler shape (`releases.ts:229-262`): `await assertDraftRelease(db, releaseId);`
→ duplicate-root check → `await assertItemExists(db, ...)` per item →
`const result = await db.transaction(async (tx) => { delete old items; insert new; return ... })`.

`addToRelease` (`releases.ts:144-158`) and `removeFromRelease` (`~181-194`)
run `assertDraftRelease(db, ...)` then a single insert/delete on `db`, with
no transaction.

`duplicateBlock` body (`blocks-block-endpoints.ts:898-907`):

```ts
body: z.object({
  rootId: z.string(),
  branchId: z.string(),
  blockId: z.string(),
  targetParentBlockId: z.string(),
  targetProperties: z.record(z.string(), z.unknown()).optional(),
  targetSlug: z.string().optional(),
  targetIndex: z.number().int().min(0).optional(),
  message: z.string().optional(),
}),
```

`moveBlock` body (`blocks-block-endpoints.ts:555-563`) ends with
`expectedHeadCommitId: z.string().optional(),` — copy that line.

Child-mode write in `runDuplicate` (`blocks-context.ts:315-322`):

```ts
const { commit } = await writeCommit(tx, def, {
  rootId: input.rootId,
  branchId: input.branchId,
  parentCommitId: oldHeadId,
  message: commitMessage(input.message, `Duplicate block ${input.blockId}`),
  createdBy: userId,
  changed,
});
```

Existing HEAD_MISMATCH test (`blocks.test.ts:2283-2320`) creates a root,
creates a block to advance the head, then calls `deleteBlock` with the stale
head and asserts `.rejects.toThrow(/advanced since/)`, then succeeds with the
current head.

## Commands you will need

| Purpose    | Command                                                                                                                     | Expected on success |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Install    | `bun install --frozen-lockfile`                                                                                             | exit 0              |
| Typecheck  | `bun run --filter=@createcms/core check-types`                                                                              | exit 0              |
| Tests      | `cd packages/cms && bunx vitest run src/core/routes/test/releases.test.ts src/core/routes/test/blocks.test.ts`              | all pass            |
| Full suite | `bun run --filter=@createcms/core test`                                                                                     | all pass            |
| Lint       | `bun run lint && bunx oxfmt --check`                                                                                        | exit 0              |

(From `CONTRIBUTING.md`; not executed by the advisor.)

## Scope

**In scope**:

- `packages/cms/src/core/routes/releases.ts` — `assertDraftRelease` and its three item-mutating callers
- `packages/cms/src/core/routes/blocks-context.ts` — `DuplicateInput` + the child-mode `writeCommit` call
- `packages/cms/src/core/routes/blocks-block-endpoints.ts` — `duplicateBlock` body schema + `$Infer` + JSDoc
- `packages/cms/src/core/routes/test/releases.test.ts`, `packages/cms/src/core/routes/test/blocks.test.ts`
- `.changeset/release-lock-duplicate-head.md` (create)

**Out of scope**:

- `duplicateRoot` (root mode of `runDuplicate`) — it creates a new root with
  `createInitialCommit`; there is no head to guard.
- `publishRelease` — already correct.
- The docs for `duplicateBlock` under `apps/docs/content/docs/reference/` —
  the field is optional and additive; if a docs-coverage test fails, see STOP.
- Real concurrency tests — the suite runs on single-connection PGlite, which
  cannot interleave two transactions; the tests below are single-threaded
  state checks.

## Git workflow

- Branch: `advisor/006-release-lock-duplicate-head`
- Commit: `fix(routes): lock release draft check in tx; add expectedHeadCommitId to duplicateBlock`
- Changeset `.changeset/release-lock-duplicate-head.md`:

  ```md
  ---
  '@createcms/core': patch
  ---

  Release item mutations check draft status under a row lock inside their
  transaction, and `duplicateBlock` accepts `expectedHeadCommitId`
  (`HEAD_MISMATCH` when the branch has advanced), like the other mutations.
  ```

- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Lock the release row in the draft check

In `packages/cms/src/core/routes/releases.ts`:

1. Change `assertDraftRelease` to take the executor and lock:

   ```ts
   async function assertDraftRelease(exec: DrizzleInstance, releaseId: string): Promise<void> {
     const [release] = await exec
       .select({ status: releases.status })
       .from(releases)
       .where(eq(releases.id, releaseId))
       .for('update');
     if (!release) throw RELEASE_NOT_FOUND();
     if (release.status !== 'draft') throw RELEASE_NOT_DRAFT();
   }
   ```

2. `setReleaseItems`: move the `await assertDraftRelease(...)` call to the
   first statement **inside** `db.transaction(async (tx) => { ... })`, passing
   `tx`. Keep the duplicate-root check and `assertItemExists` calls where they
   are (pre-transaction validation is fine; it only reads roots/branches).
3. `addToRelease`: wrap the handler body in `return db.transaction(async (tx) => { await assertDraftRelease(tx, releaseId); await assertItemExists(tx, rootId, branchId); const [item] = await tx.insert(...)...; return { item }; })`.
4. `removeFromRelease`: same shape — transaction, `assertDraftRelease(tx, ...)`, `tx.delete(...)`.

`assertItemExists` takes a `DrizzleInstance`; a transaction is structurally a
`DrizzleInstance` (see `core/types/drizzle.ts:32-40`), so passing `tx` type-checks.

**Verify**: `bun run --filter=@createcms/core check-types` → exit 0;
`cd packages/cms && bunx vitest run src/core/routes/test/releases.test.ts` → all pass.

### Step 2: Thread `expectedHeadCommitId` through `duplicateBlock`

1. `blocks-block-endpoints.ts`, `duplicateBlock` body: add
   `expectedHeadCommitId: z.string().optional(),` after `message`. Add
   `expectedHeadCommitId?: string;` to the `$Infer.body` object. Add a JSDoc
   line `@param expectedHeadCommitId Optional; reject with HEAD_MISMATCH if the branch head is not this commit.`
   and `@throws HEAD_MISMATCH when expectedHeadCommitId does not match the branch head.` (copy the wording from `moveBlock`'s JSDoc).
2. `blocks-context.ts`, `DuplicateInput`: add `expectedHeadCommitId?: string;`.
3. `blocks-context.ts`, child-mode `writeCommit` call: add
   `expectedHeadCommitId: input.expectedHeadCommitId,`.

**Verify**: `bun run --filter=@createcms/core check-types` → exit 0.

### Step 3: Tests

1. `blocks.test.ts`, inside `describe('optimistic concurrency (expectedHeadCommitId)', ...)`,
   add `it('duplicateBlock rejects a stale head and accepts the current head', ...)`:
   create a root; create block A (head H1); create block B (head H2);
   `duplicateBlock({ rootId, branchId, blockId: A, targetParentBlockId: rootId, expectedHeadCommitId: H1 })`
   → `.rejects.toThrow(/advanced since/)`; then the same call with `H2` →
   resolves and `result.commit.id !== H2`.
2. `releases.test.ts`, add `it('rejects item mutations on a published release', ...)`:
   create a root, create a release, `addToRelease`, `publishRelease`; then
   `addToRelease`, `removeFromRelease`, and `setReleaseItems` on that release
   each reject with code `RELEASE_NOT_DRAFT` (match the file's existing
   rejection-assertion style — grep `RELEASE_NOT_DRAFT` in the file; if a
   similar test exists for one of the three, extend it to cover all three).
3. `releases.test.ts`, add `it('addToRelease and removeFromRelease are transactional', ...)`:
   `addToRelease` with a `branchId` that does not belong to the root →
   rejects `BRANCH_NOT_FOUND`, and afterwards `getRelease` shows zero items.

**Verify**: `cd packages/cms && bunx vitest run src/core/routes/test/releases.test.ts src/core/routes/test/blocks.test.ts` → all pass with the new tests.

### Step 4: Full verification and changeset

Create the changeset from the Git workflow section.

**Verify**: `bun run --filter=@createcms/core check-types && bun run lint && bunx oxfmt --check && bun run --filter=@createcms/core test` → all exit 0.

## Test plan

- One new test in `blocks.test.ts` modelled on
  `'rejects a stale head with HEAD_MISMATCH and accepts the current head'`.
- Two new tests in `releases.test.ts` modelled on the existing
  `describe('releases — atomic multi-page publish', ...)` tests.

## Done criteria

- [ ] `grep -n "\.for('update')" packages/cms/src/core/routes/releases.ts` → at least 2 hits (publishRelease + assertDraftRelease)
- [ ] `grep -n "assertDraftRelease(db," packages/cms/src/core/routes/releases.ts` → no matches
- [ ] `grep -n "expectedHeadCommitId" packages/cms/src/core/routes/blocks-context.ts packages/cms/src/core/routes/blocks-block-endpoints.ts` → hits in both, including inside the `duplicateBlock` body schema
- [ ] Both test files pass with the new tests; full suite exits 0
- [ ] `bun run lint && bunx oxfmt --check` exit 0
- [ ] `.changeset/release-lock-duplicate-head.md` exists
- [ ] `git status` shows only in-scope files modified
- [ ] `advisor-plans/README.md` status row updated

## STOP conditions

- `writeCommit` no longer accepts `expectedHeadCommitId` (check
  `commit-writer.ts:68-72`).
- `runDuplicate` no longer reads `oldHeadId` from a locked branch (the
  HEAD_MISMATCH comparison relies on that lock).
- A docs-coverage test fails because `duplicateBlock`'s documented input
  shape is pinned and now differs — report; do not edit MDX in this plan.
- Any verification fails twice.

## Maintenance notes

- Any new endpoint that writes a commit on an existing branch should accept
  `expectedHeadCommitId` and pass it to `writeCommit`; the guard is silently
  off when omitted. A reviewer should check new `writeCommit` call sites for
  the field.
- Release mutations now hold the release row lock for the duration of their
  transaction; keep those transactions short (no S3 calls inside).
- Deferred: true two-writer tests need a multi-connection Postgres harness;
  the current PGlite harness is single-connection.

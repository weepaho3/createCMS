---
"@createcms/core": patch
---

Performance pass (pf-03 … pf-15). Query, index, and payload optimizations on the
hot read/merge/prune paths. Two consumer-visible changes; the rest are internal.

- **Schema (regenerate after upgrade):** added a `(collection, slug)` index on
  `roots` for the public `getPublishedContent` slug lookup (pf-03), and removed
  the unused `bv_properties_gin` GIN index on `block_versions.properties` — it
  could not serve any existing query (all predicates are `->> ... ILIKE`, which
  jsonb_ops GIN does not accelerate) and only cost write amplification on the
  highest-churn table (pf-06). Run `createcms generate` + a migration to pick up
  both.
- **`getPublishedContent` A/B shape + branch selector (pf-07):** added an
  optional `branchName` query param — when set, only that published branch is
  resolved (still returned as a length-1 `variants[]`); omitted, behavior is
  unchanged. Embedded A/B references no longer serialize the control branch
  **twice**: the control tree is the top-level `tree`/`properties`, and
  `abTest.variants` now carries only the non-control variants. Consumers that
  previously read the control snapshot out of `abTest.variants` should read the
  top-level tree instead.

Internal (no API change): `resolveLinkPaths` resolves internal link targets in
parallel instead of serially on the published-content path (pf-04); `listRoots`
uses a slim `COUNT(DISTINCT roots.id)` query for the total instead of re-running
the full aggregate/enrichment join twice (pf-05); `executeRootPruning` deletes
prunable commits in a single set-based statement instead of one round trip per
commit (pf-11); `executeMerge` computes the merge base before taking the branch
`FOR UPDATE` locks and reuses it only when the locked heads are unchanged,
shortening lock hold time without changing merge-base semantics (pf-08);
`archiveAssets` batches the live-reference check across the input instead of one
query per asset (pf-12).

Also documents several intentional cost/scaling tradeoffs (snapshot-per-commit,
`listRoots` search vs. the `search` endpoint, the default A/B edge resolver's
per-request fetch, and the realtime per-recipient publish model).

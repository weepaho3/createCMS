---
"@createcms/core": patch
---

Code-cleanup pass (cc-01 … cc-16) — mostly internal (behavior-preserving dedup,
dead-code removal, comment cleanup), with three consumer-visible fixes:

- **Reopening a comment thread now emits a `threadReopened` notification** (was
  incorrectly `threadResolved`); added to the notification-type enum + router
  meta map (cc-11).
- **`deleteCommentMessage` now reports `operation: 'delete'`** to your
  `authMiddleware`/permission matrix (was `'update'`, inconsistent with every
  other delete) (cc-11).
- **List endpoints parse raw timestamps as UTC** (`listRoots`, root history,
  `listMergeRequests`) via `parseTimestamp`, fixing an off-by-timezone `Date` on
  non-UTC hosts (cc-06).

Internal: extracted `lockWritableBranch` (7 duplicated branch-lock preambles),
`loadVersionMapAtCommit` + `collectDescendantIds`, `patchSingleVersion`
(updateBlock/updateRoot shared core), `withNotifications` (11 collect-then-flush
sites), `isUniqueViolation` + `chainFor`, `loadBoundaryMessages` +
`mapRawThreadRow`, and `toInsertRow`; removed dead code (unused import/var, two
unused `TableDefinition` type params, the `blockToOutput` wrapper), tightened a
few micro-nits, and stripped undocumented internal design codenames from comments.

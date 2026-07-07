---
"@createcms/core": patch
---

API return-shape consistency pass (ret-01 … ret-22). Pre-1.0, these replace the old
shapes cleanly (no compat shims). Highlights:

- **Commit envelope.** Every commit-producing mutation (createRoot, createBlock,
  moveBlock, deleteBlock, duplicateBlock, updateBlock, updateBlocks, updateRoot,
  revertBranch, executeMerge) now returns `{ commit: { id, message, createdAt,
  createdBy }, ... }` — one uniform shape instead of three divergent keys
  (`commitId` / `newCommitId` / `mergeCommitId`). `executeMerge` fast-forward now
  returns the resulting head commit instead of `mergeCommitId: null`. `updateBlocks`
  adds `changed: boolean` so a no-op save is distinguishable from a real commit.
- **Entity envelope.** Entity-returning mutations wrap the row as `{ <resource>: row }`:
  `createBranch`/`renameBranch` → `{ branch, isDeletable }`, `createMergeRequest` →
  `{ mergeRequest, hasConflicts, conflicts }`, `update`/`close`/`reopenMergeRequest` →
  `{ mergeRequest }`, `publishBranch` → `{ publication }` (now incl. `branchName`),
  `approve`/`reject` → `{ approval }`, comment message mutations → `{ message }`.
- **Richer reads/mutations.** `getRoot`/`getRootBySlug` now return the full
  `RootListItem` (counts + path), not a bare summary. `createRoot`/`updateRoot`/
  `duplicateBlock` return the server-normalized `slug`/`path`; `moveRoot`/`deleteRoot`/
  `updateRoot` return `redirectsCreated` (and `moveRoot` the effective `sortOrder`);
  `deleteBlock` returns `deletedBlockIds`; `unpublishBranch` returns
  `unpublishedCommitId`/`unpublishedAt`.
- **List consistency.** `getRootHistory` now returns `{ commits, total, hasMore }`
  (was `{ data, total, offset, limit }`); `listTemplates`/`listVariables` gain
  `limit`/`offset`/`search` + `{ …, total, hasMore }`. `updateAssetStatus` returns
  `{ updated, updatedIds, skipped }`; `uploadAssets`/`replaceAsset` return the full
  asset row.
- **Type fixes.** `getRootHistory.createdAt` and `createSignedUpload.expiresAt` are now
  `Date` (were an ISO string / epoch-ms). `deleteTemplate`/`deleteVariable` echo the
  deleted id (`{ templateId }`/`{ variableId }`) instead of `{ deleted: true }`.
  `getDiff`/`checkConflicts`/`checkDivergence` are now `GET` (were `POST`).
- **Bug fix.** `listMentions` now populates each message's `mentions` (was always `[]`).

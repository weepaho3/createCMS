---
"@createcms/core": patch
---

Add a `forceCommitMessage` option to the CMS config. When `true`, every content mutation (createRoot / createBlock / updateBlock / deleteBlock / moveBlock / duplicateBlock / updateBlocks / updateRoot) requires a non-empty `message` — an empty or whitespace-only message is rejected with the new `COMMIT_MESSAGE_REQUIRED` error instead of falling back to an auto-generated default. Off by default, so existing behavior is unchanged.

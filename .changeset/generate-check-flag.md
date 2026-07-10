---
'@createcms/core': patch
---

feat(cli): add `createcms generate --check` — verify the committed schema is up to date without writing, exiting non-zero on drift (for CI). Reuses the exact generator, so it never diverges from what `generate` would write.

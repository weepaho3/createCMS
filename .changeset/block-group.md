---
"@createcms/core": patch
---

Add an optional `group` string to block definitions — an editor hint for the block-picker category a block appears under (e.g. `group: 'Forms'`). Presentational only; the package does not act on it. Free-form by design; reference a shared `as const` object for consistent, autocompleted group names across blocks.

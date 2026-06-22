---
"@createcms/core": patch
---

Add an optional `group` string to block property definitions — an editor hint for the field-group (fieldset/section) a field is shown under in the property panel (e.g. `group: 'SEO'`). Presentational only; free-form, use a shared `as const` for consistent, autocompleted group names. Mirrors the block-level `group`.

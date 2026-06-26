---
"@createcms/core": patch
---

Variables now participate in multi-tenant and i18n scoping.

- **multi-tenant** — variables are partitioned per tenant. The same key is independent across tenants, and content resolves the active tenant's value.
- **i18n** — variables are per-language **with fallback**, exactly like a translated entry: a value is resolved in the active language, falling back through the configured chain to the default language when it has no value there. Define shared values once (in the default language) and override only the few that need translating. Content rendering (`getBlockTree` / `getPublishedContent`) and template-embedded variables both resolve through this. Implemented via a plugin-provided `VariableResolver` on the resolved scope (mirrors the reference resolver).
- **Management** (create/list/update/delete) targets the exact active cell (tenant + language) — no fallback when editing. Uniqueness is per `(tenant, language, key)`, enforced at the app level (the core `key` unique index is demoted to a lookup, since the compound key can't be expressed by either plugin alone). The delete guard and revalidation are tenant-scoped (language-spanning, since a base value can be rendered via fallback in any language).

**Schema change, no backfill (beta):** the `variables` unique index is demoted to non-unique, and the `i18n` / `multi-tenant` plugins add a `language` / `tenant_slug` column to `variables`. Recreate the database.

---
"@createcms/core": patch
---

Templates now participate in i18n / multi-tenant scoping and are applied server-side on `createBlock`.

- **Scoped templates.** With the `i18n` plugin a template is per **language**; with `multi-tenant` it is per **tenant**. All template CRUD is scope-filtered, and the `(collection, blockType, propertyKey)` uniqueness is enforced **within** the active scope — so the same key can have a different default per language and per tenant. (The core DB unique was demoted to a lookup index; per-scope uniqueness is the app-level authority, mirroring redirects.)
- **Server-side application.** `createBlock` now seeds any **optional** property the caller leaves unset from its template — no client wiring needed. Required properties must still be provided (input is validated before defaults apply); `duplicateBlock` and `updateBlocks` do not re-apply templates (they copy / apply a client-authoritative tree). Caller-provided values always win. The raw template string is stored, so embedded `{{variables}}` stay live (resolved at read time), not frozen at creation.
- **Validated targets.** `createTemplate` now rejects a template whose `propertyKey` does not exist on the block type, or is not a text property (`string` / `richText`), with the new `TEMPLATE_PROPERTY_INVALID` error — a string template can no longer be seeded into a number/select/image/reference field.

**Schema change, no backfill (beta):** the `templates` unique index is demoted to non-unique, and the `i18n` / `multi-tenant` plugins add a `language` / `tenant_slug` column to `templates`. Recreate the database.

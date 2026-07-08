---
"@createcms/core": patch
---

Naming-consistency pass (naming-01 … 25). Many **breaking** renames (pre-1.0, no
aliases) that remove diverged/ambiguous names across the public surface.

Renamed identifiers:

- **Context types** standardized on the `Context` suffix: `CMSMiddlewareCtx` →
  `CMSMiddlewareContext`, `CMSProcedureCtx` → `CMSProcedureContext`,
  `CMSHandlerCtx` → `CMSHandlerContext`, `CMSSystemHandlerCtx` →
  `CMSSystemHandlerContext`. The duplicate `CMSEndpointCtx` is removed; use
  `CMSEndpointContext` (now the complete shape).
- **Slug config**: `slug.root` → `slug.prefix`, `slug.allowRoot` →
  `slug.allowIndex` (avoids colliding with the top-level `basePath` and the many
  other meanings of "root").
- **List rows**: `RootListItem` / `RootSummary` expose their own key as `id`
  (was `rootId`), matching every other list item.
- **Permission resources**: `'variables'` → `'variable'` and `'templates'` →
  `'template'` (now all singular); new exported `CMSPermissionResource` union so
  a typo in a permission matrix is a compile error.
- **Endpoint keys**: `resolveConflicts` → `applyConflictResolutions`, `approve` →
  `submitApproval`, `reject` → `submitRejection` (the bare verbs implied a lookup
  / were ambiguous as hook actions).
- **Generated schema**: `createcms generate` now emits
  `export const cmsSchema = pgSchema('cms')` (was `cms`), so `typeof cms` no longer
  collides with your `createCMS` instance. Regenerate your schema.
- **Client store**: `CMSClientStore.notify(signal)` → `invalidate(signal)` (it
  toggles a cache-invalidation signal, distinct from `cms.notify` which sends a
  user notification).
- **Inference marker**: `cms.$notifications` → `cms.$InferNotifications` (type-only
  phantom; joins the `$Infer*` family).
- **Renderers**: `createBlocksRenderer` is removed (it was `createBlocksMap` +
  `BlocksRenderer` inline); use `createContentRenderer` (the one convenience
  factory) or `createBlocksMap` + `BlocksRenderer` for the low-level path.
- **Type-prefix cleanups**: `ABTest*` → `AbTest*`, `GA4Payload`/`GA4ServerConfig`
  → `Ga4Payload`/`Ga4ServerConfig`, `CMSEvent` → `AnalyticsEvent`,
  `MultilingualMiddlewareResult` → `I18nMiddlewareResult`, generic param `TCms` →
  `TCMS`, zod export `notificationEvent` → `notificationEventSchema`, and the
  unprefixed client types `QueryState` / `MediaUploadState` /
  `MediaUploadFileState` / `MediaUploadOptions` → `CMS*`-prefixed.

Docs-only: error messages and JSDoc now say "root"/"entry" instead of "page" for
an entry; the variant-selection verb ladder is documented; `CMSHooks` and
`CMSConfigHooks` cross-reference each other.

(naming-06, naming-07, naming-09, naming-19 were already resolved by earlier
passes.)

---
"@createcms/core": patch
---

API-design consistency + hardening pass (api-02 … api-22). Pre-1.0, breaking
changes are applied cleanly (no compat shims).

**Correctness / hardening**

- **api-02**: the client now dispatches HTTP methods from a server-generated
  `$pathMethods` map instead of guessing from body presence, so optional-body
  POST endpoints (`admin.reindexSearch`, `admin.runPruning`,
  `notifications.markNotificationsRead`/`Unread`) no longer wrongly send GET.
- **api-03**: `createCMS` now throws when a collection name collides with a
  reserved namespace (`admin`/`media`/`variables`/`templates`/`search`/`notifications`/`realtime`)
  or a plugin id, or isn't a URL-safe slug — previously such a collection was
  silently clobbered and its routes 404'd.
- **api-09**: plugin ids must be valid JS identifiers and every plugin endpoint
  path must be `/<id>/<method>` (throws otherwise). The bundled multi-tenant
  plugin's id changed `multi-tenant` → `multiTenant` to comply.
- **api-10**: endpoint-conflict detection now spans the full core+collection+plugin
  surface and throws on a duplicate path (was plugin-only + `console.warn`).
- **api-19**: server-side `cms.api.*` callers accept `{ headers?, context? }`; a
  `context.userId` is honored as the actor when no auth middleware resolves one
  (HTTP clients can't set `context`, so this stays a trusted server-side channel).
- **api-04** (security): approval endpoints no longer take `reviewedBy`/`requestedBy`
  from the request body (spoofable). The actor is derived from the auth context;
  a reviewer must match one of `requestedReviewers`. Corrected the branches/merges
  JSDoc that described the wrong `createdBy` precedence.
- **api-08 / api-16 / api-20**: vanilla client exposes `media.uploadState` (a real
  atom) instead of a mistyped `useUploadAssets`; `$ERROR_CODES` / `err.cmsCode`
  now cover core **and** plugin codes; removed the dead `$InferServerPlugin`.

**Renames (breaking)**

- `deleteRoot` → `archiveRoot` (it soft-archives).
- `search.search` → `search.query` (param `q` → `search`).
- `notifications.listNotifications` / `templates.listTemplates` / `variables.listVariables` → `.list`.
- `media.archiveAsset` → `archiveAssets`; `media.updateAssetStatus` → `updateAssetsStatus`.
- List **direction** param unified to `sortDirection` (was `sortOrder` on `listAssets`/`listPublications`).
- `moveRoot` body param `sortOrder` → `position` (the result field stays `sortOrder`).
- Template endpoints' `id` param → `templateId`; `listFolders` `parentId` → `parentFolderId`.
- `moveFolder` accepts an explicit `null` parent (detach), matching `moveRoot`/`moveAssets`.

**Smaller items**

- **api-11**: `resolveTemplate` is now GET. **api-17/18**: documented `listFolders`
  (intentionally per-level) and `listRoots.filterValue` ILIKE-pattern semantics.
  **api-21**: added `duplicateRoot` (a thin, statically-typed wrapper over
  `duplicateBlock`'s root mode). **api-22**: documented the two identifier-lookup
  conventions.

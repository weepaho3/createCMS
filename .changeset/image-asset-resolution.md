---
"@createcms/core": patch
---

Resolve `image` block properties to `{ id, slug }` on the rendered read path.

`image` properties store the asset **id** (`ast_…`). `getPublishedContent` (and `getBlockTree` unless `raw`) now resolves each one to `{ id, slug }` — exactly as `link` and `reference` properties are resolved — so a renderer builds the gate URL `/media/asset/{slug}` straight from the slug, with no second lookup. This keeps the SEO-friendly slug in the URL and routes every image request through the status-checked gate, while the id stays the stored value (usage tracking and the archive guard are unaffected).

Resolves to `null` when the asset is archived or out of scope — the resolver is scoped, so a forged cross-tenant id in content never leaks another tenant's slug, symmetric with link resolution. A `raw` read keeps the stored id for editor re-picking. Type: in `resolved` mode an `image` property now infers as `ResolvedImage` (`{ id, slug } | null`).

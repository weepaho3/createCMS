---
"@createcms/core": patch
---

Add `media.replaceAsset` — swap the bytes behind an existing asset, keeping its id.

`replaceAsset({ assetId, file })` replaces an asset's content while keeping its `id` (and `folderId` / `status`) stable, so every content reference picks up the new image with **no content change and no re-render** — content stores the id and the id-addressed gate re-resolves it (the short-cached redirect propagates the swap within minutes). The classic use case: a logo / brand image changes — replace it once, and it updates everywhere it's used.

A **new** slug / object key is minted (not an overwrite) so the long CDN cache on the old object can't keep serving the stale image. The endpoint is server-side and atomic: the new object is uploaded first, then — only on success — the row is repointed in a single transaction that also **archives the asset's old variants** (they depict the old bytes and are unreachable from the new slug, so callers should regenerate variants afterward). The old object is left in the bucket for a future pruning pass. Throws `CANNOT_REPLACE_VARIANT` if the target is itself a variant (replace the original instead), `ASSET_NOT_FOUND`, `FILE_TOO_LARGE` / `INVALID_FILE_TYPE`, or `UPLOAD_FAILED` (which leaves the asset unchanged).

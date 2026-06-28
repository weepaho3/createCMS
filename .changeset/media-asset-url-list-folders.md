---
"@createcms/core": patch
---

Media: ready public `url` per asset, new `listFolders`, removed `getAssetUrlAuthenticated`.

- **`listAssets`** (and the `createSignedUpload` / `uploadAssets` responses) now include a **direct** object `url` per asset (`${publicUrl}/${objectKey}`), built server-side — so internal/admin tooling (a media library) needs no URL helper and never has to know `publicUrl` itself. This URL bypasses the gate (no status check, no transforms); it is for admin display, not for embedding in content. Content references an asset by id and is served through the gate, `GET /media/asset/{slug}`.
- **New `listFolders({ parentId? })`** read endpoint: returns the direct child folders of `parentId` (or the root-level folders when omitted), sorted by name. This is the missing read counterpart to `createFolder`/`moveFolder`/`deleteFolder`, so a media-library UI can navigate the folder tree.
- **Removed `getAssetUrlAuthenticated`** (and the internal `signGetObject` helper). Uploaded objects are `public-read`, so the presigned-GET path was redundant — `status` is a visibility flag gating the public `/media/asset/{slug}` redirect, not a hard-privacy boundary. Serve assets through that gate; flip an asset to `public` with `updateAssetStatus` to serve it there.

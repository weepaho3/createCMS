---
'@createcms/core': minor
---

Private assets are private in the bucket. With the new default
`media.visibility: 'prefix'`, objects live under `pub/` or `prv/` (after a
`t/<tenant>/` segment under the multi-tenant plugin) and move by copy plus
delete when the asset status changes; a bucket policy on `pub/*` grants
public reads. The gate serves private assets to callers the auth middleware
accepts, through a signed GET of at most 300 s with
`Cache-Control: private, no-store`, and enforces the caller's scope. Asset
responses return `url` only for public assets and add `deliveryUrl`.
`media.acl` defaults to `false`, `media.onPurge` receives the gate paths to
purge after a move, and `createcms storage check` verifies the lifecycle
rule, CORS, uploads without ACLs and the `pub/` policy.

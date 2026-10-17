---
'@createcms/core': minor
---

`StorageAdapter` declares the full provider capability model (`signedPut`,
`signedPost`, `signedGet`, `copy`, `list`, `deleteMany`, `multipart`,
`objectAcl`, `conditionalPut`, `checksum`, `corsConfigurable`, `lifecycle`,
rate and size limits) and gains optional `copy`, `deleteMany` and `list`,
which the S3 adapter implements with `CopyObject`, `DeleteObjects` and
`ListObjectsV2`. Presets in `providerCapabilities` cover AWS, R2, B2,
DigitalOcean Spaces, Hetzner, Bunny, Supabase and generic S3 servers;
`provider: 'custom'` picks one with `preset`, and `media.capabilities`
overrides single flags. Every object is written with an immutable
`Cache-Control`.

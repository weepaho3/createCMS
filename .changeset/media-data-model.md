---
'@createcms/core': minor
---

Media data model: assets store `width`, `height`, `originalName`, `sha256`,
`provenance`, a canonical `variantKey`, `revisionOf` and validated
`metadata` (`AssetMetadata`: focal point, placeholder, rights, C2PA and
IPTC provenance, allowlisted EXIF without GPS, media facts); `size` is a
`bigint`. Asset responses carry these fields and the live `variants` (one
extra query per page). Variant uploads take a `variantKey`
(`w{width}[-h{height}][-q{quality}][-fit{mode}].{format}`), validated and
unique per asset; the gate resolves `?w`/`?format` by key first.
`admin.runMediaBackfill` fills the new columns for existing rows.
Requires `createcms generate` and a migration.

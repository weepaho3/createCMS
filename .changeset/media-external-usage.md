---
'@createcms/core': minor
'@createcms/react': minor
---

External usage registry. Integrations push uses of an asset outside the
CMS with `registerExternalUsage({ assetId, consumer, url })` and remove
them with `removeExternalUsage`; the entries live in the host's
`media.externalUsage` registry, not in a CMS table. `getAssetUsages`
returns them in a new `external` group together with the
`media.usageSources` hits (`blocking: true`). Registered usages only warn:
`archiveAssets` archives such assets and reports them in
`externalUsages`. The new error code is `EXTERNAL_USAGE_NOT_CONFIGURED`.
The React usage panel gains `Usage.ExternalList` and `Usage.ExternalItem`,
the store keeps `mutation.externalUsages`, and the archive outcome warns
with `bulk.archivedExternal`.

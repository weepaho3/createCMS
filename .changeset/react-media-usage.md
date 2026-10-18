---
'@createcms/react': minor
---

`Usage` parts (`Usage.Root`, `Count`, `ScopeSwitch`, `MissingAltFilter`,
`List`, `Item`, `Occurrence`, `Empty`, `LoadMore`) show where an asset is
used, with links into the editor through an `EditorHrefAdapter`
(`createEditorHrefAdapter`). `useAssetUsages` pages through the usages and
`useAssetUsageCounts` batches badge counts per frame.
`MediaClient.getAssetUsages` returns the grouped `MediaUsagePage`.

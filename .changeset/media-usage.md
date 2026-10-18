---
'@createcms/core': minor
---

Asset usage: the usage index records every occurrence of an asset, a
reference or an internal link by the property schema, with its JSON pointer
path, alt-text state and revision pin, and finds asset URLs in text.
`getAssetUsages` answers by scope (`live`, `published`, `history`, one
branch), groups by root with title, status and the embedding reusable
block, filters missing alt text and paginates; `getAssetUsageCounts`
returns badge counts for up to 200 assets; `replaceAssetUsages` swaps one
asset for another in all content, one commit per root and branch.
`listAssets` filters by `usage`, `usageScope`, `missingAlt` and
`unusedSinceDays`. `archiveAssets` protects assets used by any branch head
or by a `media.usageSources` entry, and pruning never reclaims an asset a
commit still uses. `admin.runUsageBackfill` re-indexes existing versions.

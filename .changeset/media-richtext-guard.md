---
'@createcms/core': minor
---

`archiveAssets` skips assets whose id appears inside a longer string of any
block version (rich text HTML, stringified JSON), since the usage index does
not see such references, and pruning never reclaims them. The response adds
`skippedReasons` (`in_use` or `richtext_suspect`); `force: true` archives
suspects anyway. Turn the check off with
`media.guardRichTextReferences: false`.

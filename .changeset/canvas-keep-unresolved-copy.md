---
'@createcms/react': patch
---

Canvas keeps stored string and link values while resolve is pending or misses, so button labels stay visible. `useCmsDocument` settles unchanged strings to the stored value instead of `undefined`.

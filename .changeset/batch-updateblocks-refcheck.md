---
'@createcms/core': patch
---

perf(blocks): batch updateBlocks reference-existence checks into a single asset query and one roots query per collection, shortening the write-transaction critical section for large page saves

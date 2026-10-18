---
'@createcms/react': patch
---

The canvas no longer throws in Firefox when it measures or unmounts while
its frame is not rendered: `getComputedStyle` returns `null` there, and
every style read now treats that as no style.

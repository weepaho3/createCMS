---
'@createcms/core': patch
---

`admin.runScheduled` and `releases.publishRelease` now fire `onRevalidate`
events for every page they publish or unpublish, matching `publishBranch`
and `unpublishBranch`.

---
'@createcms/react': patch
---

Media library fixes found by the new engine tests: a file dropped in WebKit
no longer gets lost when its file-system entry does not resolve (files are
read directly, entries only for folders), and upload progress no longer
re-renders `Media.Grid` (the grid subscribes to the ids of uploads in view,
each upload tile to its own entry).

---
'@createcms/react': patch
---

The Yjs store repairs cycles from concurrent moves in the shared document:
the block whose placement was written first goes back to where its last
move took it from, or to the end of the root. The repair is written with
origin `system`, never becomes an undo step, and resolves the same way on
every peer; `DocStoreCore.receive` takes that origin.

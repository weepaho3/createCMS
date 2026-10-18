---
'@createcms/react': patch
---

`runDocStoreConformance` in `@createcms/react/editor/core` checks a custom
`DocStore` against the editor's contract (atomic transactions, origins,
change events, atomic moves, undo and redo, history exclusions, marks,
merging) without a test framework, and the guide "Write your own DocStore"
covers cycles, order keys and presence for shared stores.

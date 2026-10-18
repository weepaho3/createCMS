---
'@createcms/react': patch
---

`createMemoryAdapter` in `@createcms/react/editor/core` keeps documents in
memory behind the `EditorAdapter` contract (stale `baseVersion` rejected as
`conflict`), and `useAdapterDocument` in `@createcms/react/editor` loads a
document through any `PersistenceAdapter` and returns what `Editor.Root`
needs to edit and save it.

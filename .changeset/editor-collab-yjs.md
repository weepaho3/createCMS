---
'@createcms/react': patch
---

`@createcms/react/editor/collab` adds `createYjsDocStore`, a `DocStore` over
a `Y.Doc` for several people editing one document: one `Y.Map` per block,
placement written as one value with a fractional order key (concurrent
moves never duplicate a block), and the same tree derived on every peer,
with blocks moved into a removed parent or into a cycle shown at the end
of the root. `yjs` (13.6.33) and `y-protocols` are optional peers;
`fractional-indexing` is a new dependency used only by this entry.
`createDocStoreCore` in `@createcms/react/editor/core` exposes the shared
history and transaction logic for stores with other backends.

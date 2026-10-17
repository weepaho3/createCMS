---
'@createcms/react': minor
---

New subpath `@createcms/react/editor/core`: the React-free editor kernel with
the store (`createEditorStore`, `applyOp`, `flattenTree`, `serializeToTree`,
`stableHash`, `createBlockId`) and the schema helpers (placement, defaults,
fields, palette, validation) plus their types. It has no directive and no
runtime dependency, so servers, workers and Server Components import it
without React. `@createcms/react/editor` no longer exports these names;
import them from `@createcms/react/editor/core`.

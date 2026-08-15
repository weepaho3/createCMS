# @createcms/schema

Shared, runtime-free type vocabulary for createcms blocks, collections, and
trees — the _schema_ (`CollectionDefinition`: root + blocks + structure),
_field kinds_ (`BlockPropertyType` + `list`), the _tree_ (`BlockTreeNode` /
`InferBlockTreeNode`), and _raw vs resolved_ (`RefMode`).

This package ships **no runtime code** — every export is `export type`. It
exists so that `@createcms/core` and `@createcms/react` (a headless editor
primitive with zero runtime dependency on core) can share the exact same
block/collection/tree/link/reference types instead of maintaining a
hand-copied mirror that silently drifts.

`@createcms/core` consumes this package as a `devDependency`. A TypeScript
`paths` alias resolves it to source for `tsc --noEmit` and the IDE only; the
types are **inlined** into core's published `.d.ts` files by building core
with `bunchee --dts-bundle`, which keeps only real
`dependencies`/`peerDependencies` external, and every one of those inlined
types is re-exported from `@createcms/core` — so application code that uses
core keeps importing from `@createcms/core` rather than depending on this
package directly. `@createcms/react` depends on `@createcms/schema` directly
(types only, no runtime dependency), since it has no `@createcms/core`
dependency to inline them for it. This package is published on npm as
`@createcms/schema`.

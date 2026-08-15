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

Both `@createcms/core` and `@createcms/react` consume this package as a
`devDependency`. A TypeScript `paths` alias resolves it to source for
`tsc --noEmit` and the IDE only; the types are **inlined** into each
package's published `.d.ts` files by building with `bunchee --dts-bundle`,
which keeps only real `dependencies`/`peerDependencies` external. Every one
of those inlined types is re-exported from `@createcms/core`, so application
code imports them from `@createcms/core` — or gets them inlined through
`@createcms/react`, which has no `@createcms/core` dependency to re-export
them for it. This package itself is `private` and never published.

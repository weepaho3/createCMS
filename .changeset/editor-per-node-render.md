---
'@createcms/react': minor
---

The canvas renders per node: each block subscribes to its own node and each
slot to its own id list, so an edit re-renders one block and a reorder
re-renders none. Canvas listeners bind once and drag gestures read the
document at event time. Every block sits in an error boundary:
`Canvas.BlockError` (or `renderBlockError`) replaces a block that throws and
reports a `render` error to `onError`; `Canvas.UnknownBlock` (or
`renderUnknownBlock`) shows a type without a component, selectable and
unchanged. `chunkSize` groups long documents into `content-visibility`
chunks.

Documents load through `loadDocument`: component `migrations` and `aliases`
run, duplicate ids and props of the wrong type are repaired, and every change
is a diagnostic (`onDiagnostics`). Components can declare `resolveData`,
whose results live in the session (`useComputed`, `useNodeStatus`) and never
in the document. Warnings carry codes (`[editor:E005]`) linking to the new
Editor codes page and are dropped from production builds.
`@createcms/react/editor/render` adds `renderDocument`, a production renderer
for React Server Components, and `createWorkerTasks` moves whole-document
validation and merges to a worker.

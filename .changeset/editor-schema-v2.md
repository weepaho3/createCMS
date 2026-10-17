---
'@createcms/react': minor
---

The editor has its own schema and document model instead of createcms
collection definitions and block trees. `defineEditorSchema` and
`defineComponent` (in `@createcms/react/editor/core`) declare components with
a `Field` union (`text`, `textarea`, `number`, `boolean`, `select` with
`multiple`, `date`, `color`, `richText`, `media`, `link`, `reference`, `list`,
`object`, `custom`), named `slots`, `permissions`, `providesContext` /
`usesContext` and props inferred with `InferProps`. `Editor.Root` takes that
schema and an `EditorDocument`; the store serialises with `getDocument()`,
`onSave` and `onChange` receive the document, and the typed factory exposes
`DocumentOf` / `NodeOf`.

Validation returns codes, paths and params (`validateField`, `validateNode`,
`validateDocument` with edit and publish phases and async Standard Schema
validators); `formatFieldError` gives the English default text.
`exportJsonSchema` describes the components as JSON Schema. Fields can be
hidden (`hidden`, `when`), read-only (`readOnly`) or resolved per node
(`resolveFields`), and values can be responsive (`$r`) or localized (`$l`)
with `resolveResponsive` / `resolveLocalized`.

`Canvas.Root` components receive `{ id, type, props, children, node, edit }`,
`resolve` maps field kinds to generic resolvers, `Canvas.ReadonlySubtree`
wraps embedded read-only trees, and `EditProps` (with `data-editor-slot`
anchors) lives in `@createcms/react/editor/core`.

`media` values are `{ assetId }` plus optional settings for that use (`alt`,
`decorative`, `altSource`, `caption`, `revisionId`, `crop`, `focal`).

`@createcms/react/editor/cms` is the createcms adapter: `fromCollection`,
`toEditor` / `fromEditor`, `createCmsAdapter`, `cmsCanvasComponents`, and
`useCmsDocument({ definition })` returning `doc`.

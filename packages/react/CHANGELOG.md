# @createcms/react

## 0.2.0

### Minor Changes

- [#98](https://github.com/weepaho3/createCMS/pull/98) [`bea8451`](https://github.com/weepaho3/createCMS/commit/bea84517ae45eeeed49e292f3bf89bdeaeb25a21) Thanks [@weepaho3](https://github.com/weepaho3)! - Structure parts for `@createcms/react/editor`: `Editor.OutlineItem` (tree row
  with selection, arrow navigation, Alt+arrow reorder, Delete with an `onDelete`
  veto and focus return, Escape), `Editor.AddBlock` (inserts a palette type at
  the selection point and selects it), `useBlockActions(id)` (placement-gated
  add/remove/duplicate/moveUp/moveDown with `canMoveUp`, `canMoveDown`,
  `canHaveChildren`, `allowedChildTypes`), typed in the factory as
  `TypedBlockActions`.

  BREAKING: `useChildren(parentId)` returns child refs `{ id, type, index }`
  instead of a string array (the factory narrows `type` to the schema's block
  types). Read `child.id` where an id was used before.

## 0.1.1

### Patch Changes

- [#96](https://github.com/weepaho3/createCMS/pull/96) [`e510694`](https://github.com/weepaho3/createCMS/commit/e51069475a2162e3b1f4d2bbf0950a8c0fc04f91) Thanks [@weepaho3](https://github.com/weepaho3)! - Field parts for `@createcms/react/editor`: `Editor.Field`, `Editor.FieldLabel`,
  `Editor.FieldControl`, `Editor.FieldDescription`, `Editor.FieldError` and
  `Editor.Form`, a typed `fields` map on `Editor.Root` for per-kind controls,
  built-in headless controls for `string`, `richText`, `number`, `boolean`,
  `date`, `select` and `list`, and `useMissingRequired()`.

## 0.1.0

### Minor Changes

- [#86](https://github.com/weepaho3/createCMS/pull/86) [`91c75ca`](https://github.com/weepaho3/createCMS/commit/91c75cafdbe99bf1246e5d0277cc2956517eb624) Thanks [@weepaho3](https://github.com/weepaho3)! - Scaffold the package: subpath entries `@createcms/react/editor`, `@createcms/react/editor/canvas` and `@createcms/react/editor/cms`, a shared editor context (`Editor.Root`, `useEditorContext`, `Canvas.Root` placeholder) and a local `useRender` / `mergeProps` / `composeRefs` copy for `render` props. Zero runtime dependencies (`react` as peer, `react-dom` as optional peer for the canvas entry).

- [#87](https://github.com/weepaho3/createCMS/pull/87) [`6b3d46f`](https://github.com/weepaho3/createCMS/commit/6b3d46f69f93a1b4708b85bdbe03d843089e6dd0) Thanks [@weepaho3](https://github.com/weepaho3)! - Editor schema helpers, pure and React-free, exported from `@createcms/react/editor`: `getPlacement`, `canPlace`, `allowedChildTypes` (the same rules as core's placement index), `defaultValuesFor` (with a `fillDefaults` option), `propertiesOf`, `groupFields`, `paletteItems`, `groupPaletteItems`, `isEmptyValue`, `validateField` (stable error codes) and `missingRequired`, plus the `EditorSchema`, `FieldKind`, `FieldSpecOf`, `FieldValueOf`, `SchemaField` types.

- [#88](https://github.com/weepaho3/createCMS/pull/88) [`dcbbe62`](https://github.com/weepaho3/createCMS/commit/dcbbe62dd458cc940274ddb1bd6bb0f2707baf76) Thanks [@weepaho3](https://github.com/weepaho3)! - Patch-based editor store: JSON operations (`add`, `remove`, `move`, `update`, `load`) with computed inverses via `applyOp`, `createEditorStore` with undo/redo of op groups (rapid updates of the same keys coalesce within 400 ms), `applyRemote` for foreign ops without history or `onChange`, per-user selection state, structural-hash dirty tracking, `save`, and the helpers `flattenTree`, `serializeToTree`, `stableHash`, `createBlockId`.

- [#89](https://github.com/weepaho3/createCMS/pull/89) [`9ce8d49`](https://github.com/weepaho3/createCMS/commit/9ce8d49ad88d0b31d81d39a3db53d6c61686a5fd) Thanks [@weepaho3](https://github.com/weepaho3)! - `Editor.Root` creates and owns the store (`schema`, `defaultValue`, `onChange`, `onSave`, `genId`, `userId`); `useEditorSelector` / `useEditorStore` (a `useSyncExternalStore` binding with shallow-equal slices); untyped hooks `useEditor`, `useAnyBlock`, `useAnyField`, `useFields`, `useChildren`, `useSelection`, `useHistory`, `useSave`, `useDirty`, `usePalette`; and the `createEditor({ schema })` factory that returns the same hooks typed from the collection definition (`TreeOf`, `BlockHandleOf`, `PropValueOf`).

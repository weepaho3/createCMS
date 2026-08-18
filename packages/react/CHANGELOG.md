# @createcms/react

## 0.3.2

### Patch Changes

- [#123](https://github.com/weepaho3/createCMS/pull/123) [`efbc7c6`](https://github.com/weepaho3/createCMS/commit/efbc7c6eb78052273dbfe8667164d3d1623b9fc5) Thanks [@weepaho3](https://github.com/weepaho3)! - Canvas keeps stored string and link values while resolve is pending or misses, so button labels stay visible. `useCmsDocument` settles unchanged strings to the stored value instead of `undefined`.

- [#123](https://github.com/weepaho3/createCMS/pull/123) [`efbc7c6`](https://github.com/weepaho3/createCMS/commit/efbc7c6eb78052273dbfe8667164d3d1623b9fc5) Thanks [@weepaho3](https://github.com/weepaho3)! - `Canvas.PaletteItem` can be dragged even when the current selection cannot host the type. A click after a palette drop does not insert a second block. Pointer drag binds move/up/cancel on the document so a reorder does not stay latched to the cursor when the handle loses the pointer.

## 0.3.1

### Patch Changes

- [#109](https://github.com/weepaho3/createCMS/pull/109) [`8b16173`](https://github.com/weepaho3/createCMS/commit/8b161730ff2a4e6cb49d87ce932187b257791512) Thanks [@weepaho3](https://github.com/weepaho3)! - `Canvas.InlineText` overlays a contentEditable glass on string and
  richText fields. Field lookup is scoped to the canvas host and the
  own block. Empty fields keep a zero-width display placeholder that
  is never stored.

- [#108](https://github.com/weepaho3/createCMS/pull/108) [`30c0378`](https://github.com/weepaho3/createCMS/commit/30c0378bee76547820c2dbc021b16c281cd7492f) Thanks [@weepaho3](https://github.com/weepaho3)! - `Canvas.DragHandle`, `Canvas.PaletteItem`, `Canvas.DropIndicator` and
  `Canvas.DragPreview` add pointer-events drag and drop on measured rects.
  `resolveInsertAt` drives the drop target; `adjustMoveIndex` corrects
  same-parent moves on commit.

- [#111](https://github.com/weepaho3/createCMS/pull/111) [`c22e64d`](https://github.com/weepaho3/createCMS/commit/c22e64de18021a7b8a6861dd718dc77aeaa67d51) Thanks [@weepaho3](https://github.com/weepaho3)! - `useCmsDocument` loads and saves a collection document through a
  duck-typed createcms client, tracks the branch head, and exposes a
  canvas `resolve` map from the references sidecar.

- [#112](https://github.com/weepaho3/createCMS/pull/112) [`da2b7f4`](https://github.com/weepaho3/createCMS/commit/da2b7f483c2aec7f9746f9da5f024343286a5b49) Thanks [@weepaho3](https://github.com/weepaho3)! - `useCmsFieldSources` exposes cached media, collection roots, variables,
  and template defaults for registry field controls, plus `assetUrl`,
  label helpers, and `useVariableSuggest` for `{{variable}}` completion.

## 0.3.0

### Minor Changes

- [#105](https://github.com/weepaho3/createCMS/pull/105) [`6c9a64b`](https://github.com/weepaho3/createCMS/commit/6c9a64b6c866a8b3d3dc9929dd689d20505858ea) Thanks [@weepaho3](https://github.com/weepaho3)! - `Canvas.Root` renders the store tree through a `components` map (plain or
  `{ _components }`), with data-only `edit` anchors, a `resolve` layer, and
  `interactive` modes. `components` is required; `children` are the overlay
  slot, not the tree.

### Patch Changes

- [#100](https://github.com/weepaho3/createCMS/pull/100) [`ee68b60`](https://github.com/weepaho3/createCMS/commit/ee68b60ad4ed5131422b8e37014a4adb74c35118) Thanks [@weepaho3](https://github.com/weepaho3)! - A11y contract for `@createcms/react/editor`: `useEditorKeyboard(scopeRef)`
  binds undo/redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y) and optionally
  Delete/Escape; built-in controls set `aria-required` when the spec is
  required; README tables for keyboard, ARIA and focus; SSR hydration test
  for `Editor.Root` + `Editor.Form`.

- [#107](https://github.com/weepaho3/createCMS/pull/107) [`d9df66b`](https://github.com/weepaho3/createCMS/commit/d9df66b0fa99a2d70c7fe0e7c442063017a6681b) Thanks [@weepaho3](https://github.com/weepaho3)! - `Canvas.BlockToolbar` and `Canvas.InsertButton` sit on the overlay.
  `resolveInsertAt` / `useInsertTarget` pick a line or box insert from
  measured rects and the parent layout flow.

- [#106](https://github.com/weepaho3/createCMS/pull/106) [`45a51e3`](https://github.com/weepaho3/createCMS/commit/45a51e3958414398709083b1cba8f9f536fd9ab2) Thanks [@weepaho3](https://github.com/weepaho3)! - `Canvas.Overlay` portals an unstyled layer over the canvas. Selection,
  hover and field rings follow measured block and field rects via
  `useBlockRect` / `useFieldRect`.

- [#103](https://github.com/weepaho3/createCMS/pull/103) [`be7d148`](https://github.com/weepaho3/createCMS/commit/be7d148942341cc52bcd69deab11c5313c180922) Thanks [@weepaho3](https://github.com/weepaho3)! - `Editor.FramePreview` shows compiled HTML or Blob output in a double-buffered
  sandboxed iframe, with selectable anchors, stale-response discarding, and
  `onIssues` for relative URLs, missing hrefs and leftover editor anchors.

- [#102](https://github.com/weepaho3/createCMS/pull/102) [`c0e0db3`](https://github.com/weepaho3/createCMS/commit/c0e0db3177c47c087578680caa45a2d9d2f40058) Thanks [@weepaho3](https://github.com/weepaho3)! - `Editor.Preview` renders a delayed raw store tree; `Editor.Form autoScroll`
  scrolls the focused block into view; `useEditor().scrollTo` scrolls a
  registered form or a `[data-block-id]` inside an optional container.

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

# Editor (`@createcms/react/editor`)

Headless editor primitive — schema, state, form and preview layer. Unstyled;
styling happens in the consumer's wrapper components (registry).

## Usage

(TODO)

## Parts

| Part          | Default element | Props                           | Data attributes |
| ------------- | --------------- | ------------------------------- | --------------- |
| `Editor.Root` | none (provider) | `schema` (required), `children` | —               |

## Hooks

| Hook               | Returns              | Notes                                                    |
| ------------------ | -------------------- | -------------------------------------------------------- |
| `useEditorContext` | `EditorContextValue` | Throws when used outside `Editor.Root`. Internal-facing. |

## Schema helpers (pure, no React)

Layer 1 of the editor primitive: pure functions over an `EditorSchema` (a
`CollectionDefinition`). No React, no DOM — `placement.ts` and `defaults.ts`
mirror `@createcms/core`'s `buildPlacementIndex`/`isPlacementAllowed` and
`defaultPropertiesFor` byte-for-byte; `validation.ts` mirrors the constraint
rules of core's zod builder without zod, and is stricter only where documented
(the editor never allows something the server rejects, or rejects something
the server accepts).

| Function                             | Signature                                                 | Notes                                                                                                   |
| ------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `getPlacement`                       | `(schema) => PlacementIndex`                              | Same rules as core's `buildPlacementIndex`.                                                             |
| `canPlace`                           | `(index, childType, parentType) => boolean`               | `'root'` for the top level; container gate, then `accepts`/`excludes`.                                  |
| `allowedChildTypes`                  | `(index, parentType) => string[]`                         | Definition order; `[]` for a non-container.                                                             |
| `defaultValuesFor`                   | `(def, { fillDefaults? }) => Record<string, unknown>`     | Declared `defaultValue`s only (core semantics); `fillDefaults` adds `false`/`0`/first option/`''`/`[]`. |
| `propertiesOf`                       | `(schema, blockType) => Record<string, BlockProperty>`    | `'root'` → root fields; unknown → `{}`.                                                                 |
| `groupFields`                        | `(properties) => FieldGroup[]`                            | Named groups first-appearance, `null` bucket last.                                                      |
| `paletteItems` / `groupPaletteItems` | `(schema) => PaletteItem[]` / `(items) => PaletteGroup[]` | Insertable block types (+ grouping).                                                                    |
| `isEmptyValue`                       | `(spec, value) => boolean`                                | Blank string, empty list, link without target = empty; `0`/`false` are values.                          |
| `validateField`                      | `(spec, value) => FieldError[]`                           | Client pre-check mirroring core's constraints; server stays authoritative.                              |
| `missingRequired`                    | `(schema, nodes) => MissingRequiredField[]`               | Save/Publish gate over blocks + root (`type === 'root'`).                                               |

| Type                   | Description                                                                      |
| ---------------------- | -------------------------------------------------------------------------------- |
| `EditorSchema`         | The editor's schema — a `CollectionDefinition`, generic over props/blocks.       |
| `AnyEditorSchema`      | The wide form every runtime helper accepts.                                      |
| `FieldKind`            | Every kind a block/root property can have (`BlockPropertyType` plus `list`).     |
| `FieldSpecOf<K>`       | The spec of one kind (e.g. `FieldSpecOf<'select'>` carries `options`).           |
| `FieldValueOf<K>`      | The wide runtime value of one kind.                                              |
| `FieldValueMap`        | Kind → wide runtime value, the closed map `FieldValueOf` indexes.                |
| `SchemaField`          | One property of a block/root: its `key` and its `spec`.                          |
| `PlacementIndex`       | Precomputed placement lookup for one schema (`rules`/`containers`/`blockTypes`). |
| `PlacementRule`        | A resolved per-parent acceptance rule (`only` whitelist or `except` blacklist).  |
| `DefaultValuesOptions` | Options for `defaultValuesFor` (`fillDefaults?`).                                |
| `FieldGroup`           | Fields under one `group` label (or the `null` ungrouped bucket).                 |
| `PaletteItem`          | A block type the palette can insert, derived from its definition.                |
| `PaletteGroup`         | Palette items under one `group` label (or the `null` ungrouped bucket).          |
| `FieldError`           | One `validateField` finding: `code`, `message`, optional list `index`.           |
| `FieldErrorCode`       | The closed set of `validateField` error codes.                                   |
| `MissingRequiredField` | A `required` property left empty on one node, from `missingRequired`.            |
| `MissingRequiredNode`  | The minimum a node must carry for the `missingRequired` scan.                    |

## Store (framework-free)

Layer 2 of the editor primitive: a small `getState`/`subscribe` core with no
React import, made to be wrapped with `useSyncExternalStore`. Every change is a small serialisable _op_ with
an inverse, so undo/redo is a stack of op groups (`HistoryEntry`), rapid
same-key updates coalesce into one undo step within `COALESCE_MS`, and
`applyRemote` applies foreign ops without touching local history — the same
op stream a later realtime layer can ship. Selection (`selected`/`hovered`/
`focus`/`editing`) is tracked per user id. Dirty tracking is a structural hash
of the tree (`stableHash`) compared against the hash at the last save/load, so
changing a value back by hand counts as clean again. Structural changes call
`onChange({ ops, version, getTree })` — never the tree itself; `load` and
`applyRemote` do not call it.

| Method                 | Signature                                               | Notes                                                                           |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `getState`             | `() => EditorStoreState`                                | Same object reference between changes.                                          |
| `subscribe`            | `(listener: () => void) => () => void`                  | Returns an unsubscribe function.                                                |
| `getTree`              | `() => BlockTreeNode`                                   | Serialises `nodes`/`rootId`; memoised per `version`.                            |
| `isDirty`              | `() => boolean`                                         | Current hash vs. the hash at the last save/load.                                |
| `load`                 | `(tree: BlockTreeNode) => void`                         | Replaces the tree; resets history and every user's selection; no `onChange`.    |
| `add`                  | `(type: string, options: AddOptions) => string \| null` | Seeds declared defaults; `null` on an unknown parent or a disallowed placement. |
| `update`               | `(id, patch, options?: UpdateOptions) => boolean`       | Merge-patch; `null` deletes a key; `false` for an unknown id.                   |
| `move`                 | `(id, parentId, index) => boolean`                      | `false` on the root, an unknown id/target, a cycle, or a disallowed placement.  |
| `remove`               | `(id) => boolean`                                       | Removes the subtree; `false` for the root or an unknown id.                     |
| `duplicate`            | `(id) => string \| null`                                | Deep-copies the subtree with fresh ids right after the original.                |
| `applyRemote`          | `(ops: readonly EditorOp[]) => ApplyRemoteResult`       | Applies ops one by one; no history, no `onChange`; rejects are skipped.         |
| `undo` / `redo`        | `() => boolean`                                         | `false` when there is nothing to undo/redo; closes the coalesce window.         |
| `select` / `hover`     | `(id: string \| null) => void`                          | Writes the local user's selection; `select` closes the coalesce window.         |
| `focus` / `setEditing` | `(target: FieldRef \| null) => void`                    | Writes the local user's field ref; closes the coalesce window.                  |
| `setUserSelection`     | `(userId, patch: Partial<UserSelection>) => void`       | Sets any user's selection fields (for a later presence layer).                  |
| `markSaved`            | `() => void`                                            | Rebaselines the dirty hash to the current tree.                                 |
| `save`                 | `(meta?: { message?: string }) => Promise<void>`        | No-op when clean or without `onSave`; awaits `onSave`, then `markSaved`.        |

| Op       | Shape                                      | Inverse                                               |
| -------- | ------------------------------------------ | ----------------------------------------------------- |
| `add`    | `{ parentId, index, node: BlockTreeNode }` | `remove` of `node.blockId`.                           |
| `remove` | `{ id }`                                   | `add` of the removed subtree at its old parent/index. |
| `move`   | `{ id, parentId, index }`                  | `move` back to the old parent/index.                  |
| `update` | `{ id, patch: Record<string, unknown> }`   | `update` with the previous values (`null` if unset).  |
| `load`   | `{ tree: BlockTreeNode }`                  | `load` with the previous tree.                        |

| Type                       | Description                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `AddOptions`               | `add`'s options: `parentId`, optional `index`, optional `properties`.                                   |
| `ApplyRemoteResult`        | `{ applied, rejected }` — the ops `applyRemote` accepted/skipped.                                       |
| `ApplyResult`              | `applyOp`'s success shape: `{ nodes, rootId, inverse }`.                                                |
| `CreateEditorStoreOptions` | Options for `createEditorStore`: `schema`, `initialTree`, `userId?`, `genId?`, `now?`, `getCallbacks?`. |
| `EditorCallbacks`          | `{ onChange?, onSave? }` passed via `getCallbacks()`.                                                   |
| `EditorChange`             | The `onChange` payload: `{ ops, version, getTree }`.                                                    |
| `EditorNode`               | One flat tree node: `{ id, type, properties, parentId, childIds }`.                                     |
| `EditorNodes`              | `Record<id, EditorNode>`.                                                                               |
| `EditorOp`                 | The `add`/`remove`/`move`/`update`/`load` op union.                                                     |
| `EditorStore`              | The store's public shape (method-shorthand signatures, bivariant).                                      |
| `EditorStoreState`         | `{ rootId, nodes, selection, history, version, savedVersion, saving }`.                                 |
| `FieldRef`                 | `{ blockId, key }` — what `focus`/`editing` point at.                                                   |
| `HistoryEntry`             | One undo step: `{ ops, inverse, key, at }`.                                                             |
| `UpdateOptions`            | `update`'s options: `{ coalesce? }`.                                                                    |
| `UserSelection`            | One user's `{ selected, hovered, focus, editing }`.                                                     |

## Types

| Type                 | Description                               |
| -------------------- | ----------------------------------------- |
| `EditorRootProps`    | Props of `Editor.Root`.                   |
| `EditorContextValue` | What `Editor.Root` shares with its parts. |

## Data attributes

(TODO — none yet.)

## Tests

| File                        | Covers                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `editor.test.tsx`           | Root provides context; parts outside Root throw.                                                            |
| `schema/placement.test.ts`  | `getPlacement`/`canPlace`/`allowedChildTypes` — placement semantics table, edge cases with ad-hoc schemas.  |
| `schema/defaults.test.ts`   | `defaultValuesFor` — declared-default-only semantics, `fillDefaults`, fresh-object-per-call.                |
| `schema/fields.test.ts`     | `propertiesOf`/`groupFields`/`paletteItems`/`groupPaletteItems` — ordering and grouping rules.              |
| `schema/validation.test.ts` | `isEmptyValue`/`validateField`/`missingRequired` — required gate, per-kind constraints, list elements.      |
| `store/hash.test.ts`        | `stableHash` — key-order-insensitive, array-order-sensitive, `undefined` dropped, `null` kept.              |
| `store/serde.test.ts`       | `flattenTree`/`serializeToTree` — shape, root type kept, round-trip, subtree, dangling id, property copies. |
| `store/ops.test.ts`         | `applyOp` — every op kind, its guards, its inverse, roundtrips, JSON-serialisability.                       |
| `store/store.test.ts`       | `createEditorStore` — actions, placement guards, undo/redo, coalescing, `applyRemote`, selection, save.     |

# Editor (`@createcms/react/editor`)

Headless editor primitive — schema, state, form and preview layer. Unstyled;
styling happens in the consumer's wrapper components (registry).

## Usage

(TODO — arrives with the state layer.)

## Parts

| Part          | Default element | Props                           | Data attributes |
| ------------- | --------------- | ------------------------------- | --------------- |
| `Editor.Root` | none (provider) | `schema` (required), `children` | —               |

## Hooks

| Hook               | Returns              | Notes                                                                              |
| ------------------ | -------------------- | ---------------------------------------------------------------------------------- |
| `useEditorContext` | `EditorContextValue` | Throws when used outside `Editor.Root`. Internal-facing; typed hooks arrive later. |

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

## Types

| Type                 | Description                               |
| -------------------- | ----------------------------------------- |
| `EditorRootProps`    | Props of `Editor.Root`.                   |
| `EditorContextValue` | What `Editor.Root` shares with its parts. |

## Data attributes

(TODO — none yet.)

## Tests

| File                        | Covers                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `editor.test.tsx`           | Root provides context; parts outside Root throw.                                                           |
| `schema/placement.test.ts`  | `getPlacement`/`canPlace`/`allowedChildTypes` — placement semantics table, edge cases with ad-hoc schemas. |
| `schema/defaults.test.ts`   | `defaultValuesFor` — declared-default-only semantics, `fillDefaults`, fresh-object-per-call.               |
| `schema/fields.test.ts`     | `propertiesOf`/`groupFields`/`paletteItems`/`groupPaletteItems` — ordering and grouping rules.             |
| `schema/validation.test.ts` | `isEmptyValue`/`validateField`/`missingRequired` — required gate, per-kind constraints, list elements.     |

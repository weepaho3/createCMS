# Editor core (`@createcms/react/editor/core`)

The kernel of the editor primitive. It has no directive and no runtime
dependency and never imports React, so servers, workers and React Server
Components can import it. It also never imports another editor subpath,
`@createcms/schema` or the media library (`boundary.test.ts`, the oxlint
override for this folder and `scripts/check-core-dist.mjs` enforce it). The parts and hooks in
[`@createcms/react/editor`](../README.md) are built on it, and
the createcms adapter in [`@createcms/react/editor/cms`](../cms/README.md)
maps createcms collections onto it.

```ts
import {
  createEditorStore,
  defineEditorSchema,
  validateDocument,
} from '@createcms/react/editor/core';
```

## Schema

An editor schema is plain data: a `root` component, the insertable
`components`, and optional global rules. React controls and renderers are
registered separately, so the schema can be read on a server.

```ts
const schema = defineEditorSchema({
  root: {
    label: 'Page',
    fields: { title: { type: 'text', label: 'Title', required: true } },
    slots: { children: {} },
  },
  components: {
    hero: {
      label: 'Hero',
      category: 'Marketing',
      fields: {
        title: { type: 'text', required: true, maxLength: 80 },
        variant: {
          type: 'select',
          options: [
            { label: 'Text', value: 'text' },
            { label: 'Image', value: 'image' },
          ],
        },
        image: { type: 'media', when: { field: 'variant', eq: 'image' } },
      },
    },
    section: {
      label: 'Section',
      fields: {},
      slots: { children: { allow: ['hero'] } },
    },
  },
});
```

| Function             | Signature                                               | Notes                                                                                  |
| -------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `defineEditorSchema` | `(schema) => schema`                                    | Identity with `const` inference, so the typed factory sees literal component names.    |
| `defineComponent`    | `(component) => component`                              | Identity with `const` inference; `InferProps` of its `fields` gives the props type.    |
| `componentOf`        | `(schema, type) => AnyComponentDef \| undefined`        | `'root'` reads the root; `aliases` resolve old type names.                             |
| `fieldsOf`           | `(schema, type) => Record<string, Field>`               | `{}` for an unknown type.                                                              |
| `groupFields`        | `(fields) => FieldGroup[]`                              | Named groups first-appearance, `null` bucket last.                                     |
| `paletteItems`       | `(schema) => PaletteItem[]`                             | Insertable components in definition order; `permissions.insert === false` is left out. |
| `groupPaletteItems`  | `(items) => PaletteGroup[]`                             | Clustered by `category`, uncategorised last.                                           |
| `defaultValuesFor`   | `(def, { fillDefaults? }) => Record<string, JsonValue>` | Declared `defaultValue`s; `fillDefaults` adds neutral values where a kind has one.     |

| Type                  | Description                                                                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EditorSchema`        | `{ root, components, canPlace?, aliases?, metadata? }`. `canPlace(child, parent, slot)` runs after the slot rules.                                                                                              |
| `AnyEditorSchema`     | The wide form every runtime helper accepts.                                                                                                                                                                     |
| `ComponentDef`        | `label`, `description?`, `category?`, `icon?`, `previewImageUrl?`, `version?`, `fields`, `slots?`, `render?`, `resolveFields?`, `migrations?`, `validate?`, `permissions?`, `providesContext?`, `usesContext?`. |
| `AnyComponentDef`     | The wide component form.                                                                                                                                                                                        |
| `ComponentPermission` | `'drag' \| 'duplicate' \| 'delete' \| 'edit' \| 'insert'`; `false` switches the action off for the component.                                                                                                   |
| `SlotSpec`            | `label?`, `allow?` (wins over `disallow`), `disallow?`, `min?`, `max?`, `defaultValue?`, `accept?(ctx)`.                                                                                                        |
| `PlaceContext`        | What `accept` receives: `{ childType, parentId, parentType, slot }`.                                                                                                                                            |
| `NodeInput`           | `{ type, props?, slots? }`: a node to create, used by slot defaults.                                                                                                                                            |
| `Migration`           | `{ to, up(props, { node }), down? }`: one step of a component's migration chain.                                                                                                                                |
| `FieldContext`        | What `hidden` predicates and `resolveFields` receive: `{ nodeId, type, context, metadata }`.                                                                                                                    |

`DEFAULT_SLOT` is `'children'`, the slot createcms trees and the store use.
`DefaultValuesOptions` is `{ fillDefaults? }`, the options of `defaultValuesFor`.

## Fields

Every field shares `FieldBase`: `label?`, `description?`, `placeholder?`,
`group?`, `required?`, `defaultValue?`, `readOnly?`, `localized?`,
`responsive?`, `hidden?`, `when?` and `validate?` (a Standard Schema
validator). `InferProps<F>` turns a field record into the props type:
required fields are required keys, `select` narrows to its option values,
`list` to its element type, `object` to its nested props.

| Type             | Value                                   | Kind-specific settings                            |
| ---------------- | --------------------------------------- | ------------------------------------------------- |
| `TextField`      | `string`                                | `inline?`, `TextConstraints`                      |
| `TextareaField`  | `string`                                | `TextConstraints`                                 |
| `NumberField`    | `number`                                | `min?`, `max?`, `step?`                           |
| `BooleanField`   | `boolean`                               | none                                              |
| `SelectField`    | option value, or a list with `multiple` | `options`, `multiple?`                            |
| `DateField`      | ISO-8601 datetime string (UTC)          | none                                              |
| `ColorField`     | CSS color string                        | none                                              |
| `RichTextField`  | HTML string                             | `marks?`, `nodes?`, `inline?`, `TextConstraints`  |
| `MediaField`     | `MediaValue` (`{ assetId, ... }`)       | `accept?`                                         |
| `LinkField`      | `LinkValue`                             | `allowedKinds?`, `allowedCollections?`            |
| `ReferenceField` | `ReferenceValue` (`{ id }`)             | `collection`                                      |
| `ListField`      | list of the `of` field's value          | `of`, `min?`, `max?`, `itemLabel?`                |
| `ObjectField`    | nested props                            | `fields`                                          |
| `CustomField`    | the `schema`'s output, else `unknown`   | `kind` (the control registered for it), `schema?` |

| Type               | Description                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `Field`            | The union of every field above.                                                                                          |
| `FieldBase`        | The settings every field shares.                                                                                         |
| `TextConstraints`  | `minLength?`, `maxLength?`, `pattern?` (a regular expression source).                                                    |
| `SelectOption`     | `{ label, value }`.                                                                                                      |
| `LinkKind`         | `'internal' \| 'external' \| 'email' \| 'phone'`.                                                                        |
| `LinkValue`        | The authored link: internal `{ rootId, collection, fragment?, query? }` or the literal target.                           |
| `MediaValue`       | `{ assetId, alt?, decorative?, altSource?, caption?, revisionId?, crop?, focal? }`: an asset plus settings for this use. |
| `MediaCrop`        | `{ x, y, width, height }` in fractions of the image.                                                                     |
| `MediaFocalPoint`  | `{ x, y }` in fractions of the image.                                                                                    |
| `ReferenceValue`   | `{ id }`.                                                                                                                |
| `FieldKind`        | Every field `type`.                                                                                                      |
| `FieldSpecOf<K>`   | The field type of one kind.                                                                                              |
| `FieldValueMap`    | Kind to wide runtime value.                                                                                              |
| `FieldValueOf<K>`  | The wide runtime value of one kind.                                                                                      |
| `FieldValue<F>`    | The value type of one field definition, including its wrappers.                                                          |
| `InferProps<F>`    | The props type of a field record.                                                                                        |
| `SchemaField`      | `{ key, spec }`: one field of a component.                                                                               |
| `StandardSchemaV1` | The Standard Schema interface `validate` and `custom.schema` accept.                                                     |

## Conditional and read-only fields

`hidden` is `true` or a predicate `(props, ctx) => boolean`; `when: { field, eq }`
is the JSON-only form and shows the field while `props[field]` equals `eq`.
Nothing is ever evaluated from a string. `readOnly` fields are shown but not
editable in the form, the canvas or inline. `resolveFields` returns partial
overrides per field key, merged over the declared fields.

| Function              | Signature                                          | Notes                                                                                    |
| --------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `isFieldVisible`      | `(field, props, ctx) => boolean`                   | `hidden`, then `when` (JSON equality).                                                   |
| `resolveFields`       | `(def, props, ctx) => Record<string, Field>`       | The component's fields after `resolveFields`.                                            |
| `createFieldResolver` | `() => (def, props, ctx) => Record<string, Field>` | Visible, resolved fields, memoised per props object while the context values stay equal. |
| `fieldContextFor`     | `(schema, getNode, nodeId) => FieldContext`        | Collects ancestors' `providesContext` values (nearest wins, filtered by `usesContext`).  |

`ContextNode` is what `getNode` returns: `{ type, parentId, properties }`.

## Responsive and localized values

A field with `responsive: true` may hold `{ $r: { base, sm?, md?, lg?, xl? } }`;
one with `localized: true` may hold `{ $l: { [locale]: value } }`. Plain values
stay valid, so a field can become responsive without migrating content. Keep
responsive values to style and layout fields; content and order stay global.

| Name                | Signature                                           | Notes                                                             |
| ------------------- | --------------------------------------------------- | ----------------------------------------------------------------- |
| `resolveResponsive` | `(value, breakpoint \| 'base') => V`                | Mobile first: a missing breakpoint inherits the next smaller one. |
| `resolveLocalized`  | `(value, locale, fallbackChain?) => V \| undefined` | The locale, then each fallback in order.                          |
| `isResponsiveValue` | `(value) => boolean`                                | A `$r` wrapper with a `base`.                                     |
| `isLocalizedValue`  | `(value) => boolean`                                | A `$l` wrapper.                                                   |
| `BREAKPOINTS`       | `['sm', 'md', 'lg', 'xl']`                          | Smallest first; `base` sits below `sm`.                           |
| `Responsive<V>`     | type                                                | `V` or the `$r` wrapper.                                          |
| `Localized<V>`      | type                                                | `V` or the `$l` wrapper.                                          |
| `Breakpoint`        | type                                                | `'sm' \| 'md' \| 'lg' \| 'xl'`.                                   |

## Placement

| Function            | Signature                                            | Notes                                                                          |
| ------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| `getPlacement`      | `(schema) => PlacementIndex`                         | Containers are the types with a `children` slot, including the root.           |
| `canPlace`          | `(index, childType, parentType) => boolean`          | Container gate, then `allow`/`disallow`, then the schema's `canPlace`.         |
| `allowedChildTypes` | `(index, parentType) => string[]`                    | Definition order; `[]` for a non-container.                                    |
| `slotAccepts`       | `(schema, parent, slot, spec, childType) => boolean` | One slot's rules plus `accept` and the schema's `canPlace`, for any slot name. |

| Type             | Description                                                                |
| ---------------- | -------------------------------------------------------------------------- |
| `PlacementIndex` | `{ rules, containers, blockTypes, global? }` for one schema.               |
| `PlacementRule`  | A resolved slot rule: `only` (from `allow`) or `except` (from `disallow`). |

## Validation

Validation returns codes, paths and params, never text; map the codes to your
own messages (`formatFieldError` in `@createcms/react/editor` has English
defaults). Three layers: structure, the built-in rules of every field, then
Standard Schema validators.

| Function           | Signature                                               | Notes                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validateField`    | `(field, value) => FieldError[]`                        | Built-in rules, synchronous. Wrappers are checked entry by entry; `$r`/`$l` on a field without `responsive`/`localized` fails.                                                   |
| `validateNode`     | `(node, component, options?) => ValidationIssue[]`      | Every visible field; hidden `required` fields are still checked when publishing (configurable).                                                                                  |
| `validateDocument` | `(doc, schema, options?) => Promise<ValidationIssue[]>` | Structure, built-in rules, then `validate` / `custom.schema` / component `validate`, which may be async. Slot `min`/`max` are warnings while editing and errors when publishing. |
| `isEmptyValue`     | `(field, value) => boolean`                             | Blank text, empty lists, links without a target, media or references without an id are empty.                                                                                    |
| `missingRequired`  | `(schema, nodes) => MissingRequiredField[]`             | Save/Publish gate over blocks and the root.                                                                                                                                      |

| Type                      | Description                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FieldError`              | `{ code, path, params? }`; `path` points into the value (list index, object key, breakpoint, locale).                                                                                             |
| `FieldErrorCode`          | `required`, `type`, `format`, `minLength`, `maxLength`, `pattern`, `min`, `max`, `step`, `minItems`, `maxItems`, `option`, `linkKind`, `linkCollection`, `linkTarget`, `responsive`, `localized`. |
| `ValidationIssue`         | `{ code, path, params?, severity }`; `path` starts with the node id. `code: 'schema'` carries the validator's text in `params.message`.                                                           |
| `StructureErrorCode`      | `duplicateId`, `unknownType`, `unknownSlot`, `placement`, `slotMin`, `slotMax`.                                                                                                                   |
| `ValidationSeverity`      | `'error' \| 'warning'`.                                                                                                                                                                           |
| `ValidationPhase`         | `'edit' \| 'publish'`.                                                                                                                                                                            |
| `ValidateNodeOptions`     | `{ phase?, ctx?, hiddenRequiredOnPublish? }`.                                                                                                                                                     |
| `ValidateDocumentOptions` | `{ phase?, hiddenRequiredOnPublish? }`.                                                                                                                                                           |
| `MissingRequiredField`    | `{ blockId, blockType, key, label }`; `label` falls back to the key.                                                                                                                              |
| `MissingRequiredNode`     | `{ id, type, properties }`, the minimum the scan reads.                                                                                                                                           |

`exportJsonSchema(schema, { target? })` returns a JSON Schema with one entry
per component (`$defs`, or `definitions` for `draft-07`). Built-in rules are
always included. A validator that exposes the
[Standard JSON Schema](https://standardschema.dev/json-schema) converter is
added with `allOf`: Zod 4.2+ and ArkType 2.1.28+ do; Valibot does through
`toStandardJsonSchema()` from `@valibot/to-json-schema` (Valibot 1.5+). Other
validators are skipped. `ExportJsonSchemaOptions` is `{ target? }` and
`JsonSchemaTarget` is `'draft-2020-12' | 'draft-07'`.

## Document model

Two forms of the same document: nested `NodeData` on the wire (persistence,
exchange, rendering) and flat `FlatNode`s keyed by id in memory, where each
node points at its parent with `parent: { id, slot }`. Children live in named
slots; the default slot is `children`. Only content is part of a document:
selection, history and UI state never are.

| Type             | Description                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `JsonValue`      | Any value that survives `JSON.stringify`/`JSON.parse` unchanged. Functions and `undefined` are not.           |
| `NodeData`       | `{ id, type, v?, props, slots?, meta? }`: one nested node. `meta` is adapter-owned and never read.            |
| `EditorDocument` | `{ schemaVersion, root }`, `root.type === 'root'`.                                                            |
| `SlotRef`        | `{ id, slot }`: a parent node and one of its slots.                                                           |
| `FlatNode`       | `{ id, type, v?, props, parent, slots, meta? }`: one flat node; `slots` maps slot names to ordered child ids. |
| `NormalizedDoc`  | `{ rootId, nodes }`: a document in flat form.                                                                 |
| `Origin`         | `'local' \| 'remote' \| 'history' \| 'system'`: who caused an op.                                             |
| `Op`             | `insert` / `remove` / `move` / `update` (merge patch, `null` deletes) / `replace` (whole document).           |

`canonicalJson(value)` returns the canonical JSON text of a `JsonValue`:
object keys sorted at every depth, `undefined` members dropped, array order
kept. Two values that differ only in key order produce the same string.

## Editor anchors

Components receive `EditProps` as plain data and spread its attributes so the
editor can map the DOM back to nodes, fields and slots. The prefix is
`data-editor-*`: `data-editor-block`, `data-editor-field`, `data-editor-slot`.

| Name        | Description                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `EditProps` | `{ active, block, field, slot? }`; spread `block` on the root element, `field.<key>` and `slot.<name>` where they render. |
| `EditAttrs` | The anchor attributes one entry carries.                                                                                  |
| `EditRef`   | A callback ref; spreads onto any element.                                                                                 |
| `NO_EDIT`   | Inactive, empty anchors for rendering outside an editor.                                                                  |

## Adapters

A backend plugs in through `EditorAdapter`. Failures throw
`EditorAdapterError` with a `kind` the editor reacts to.

| Name                     | Description                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `PersistenceAdapter`     | `load(id)`, `save(id, doc, { ops, baseVersion?, message? })` returning `{ version }`, optional `publish(id, doc)`. |
| `EditorAdapter`          | `PersistenceAdapter` plus optional `resolveReference`, `resolveField`, `fieldSources`, `uploadMedia`, `canPlace`.  |
| `FieldSources`           | Data for field controls (assets, documents, variables); the shape is adapter-defined.                              |
| `EditorAdapterError`     | `Error` with `kind` and `details`.                                                                                 |
| `EditorAdapterErrorKind` | `'validation' \| 'conflict' \| 'network' \| 'permission' \| 'not-found' \| 'unknown'`.                             |

## Store

A small `getState`/`subscribe` store over one `EditorDocument`. Rapid
same-key updates coalesce into one undo step within `COALESCE_MS`. Dirty
tracking compares `stableHash` of the serialised document with its hash at
the last load or save, so a document that only differs in representation
(key order, empty slots) loads clean. The store holds the `children` slot;
a document with another slot name throws on load.

Use `createEditorStore` to construct a store. Pure helpers: `applyOp` applies
one op and returns `{ nodes, rootId, inverse, schemaVersion }`;
`createBlockId` mints ids; `flattenTree` and `serializeToTree` convert between
flat nodes and a `NodeData` tree, and `serializeDocument` adds the schema
version; `stableHash` hashes a value for dirty detection.

| Method                 | Signature                                               | Notes                                                                            |
| ---------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `getState`             | `() => EditorStoreState`                                | Same object reference between changes.                                           |
| `subscribe`            | `(listener: () => void) => () => void`                  | Returns an unsubscribe function.                                                 |
| `getDocument`          | `() => EditorDocument`                                  | Serialises `nodes`/`rootId`; memoised per `version`.                             |
| `isDirty`              | `() => boolean`                                         | Current hash vs. the hash at the last save/load.                                 |
| `load`                 | `(doc: EditorDocument) => void`                         | Replaces the document; resets history and every user's selection; no `onChange`. |
| `add`                  | `(type: string, options: AddOptions) => string \| null` | Seeds declared defaults; `null` on an unknown parent or a disallowed placement.  |
| `update`               | `(id, patch, options?: UpdateOptions) => boolean`       | Merge-patch; `null` deletes a key; `false` for an unknown id.                    |
| `move`                 | `(id, parentId, index) => boolean`                      | `false` on the root, an unknown id/target, a cycle, or a disallowed placement.   |
| `remove`               | `(id) => boolean`                                       | Removes the subtree; `false` for the root or an unknown id.                      |
| `duplicate`            | `(id) => string \| null`                                | Deep-copies the subtree with fresh ids right after the original.                 |
| `applyRemote`          | `(ops: readonly EditorOp[]) => ApplyRemoteResult`       | Applies ops one by one; no history, no `onChange`; rejects are skipped.          |
| `undo` / `redo`        | `() => boolean`                                         | `false` when there is nothing to undo/redo; closes the coalesce window.          |
| `select` / `hover`     | `(id: string \| null) => void`                          | Writes the local user's selection; `select` closes the coalesce window.          |
| `focus` / `setEditing` | `(target: FieldRef \| null) => void`                    | Writes the local user's field ref; closes the coalesce window.                   |
| `setUserSelection`     | `(userId, patch: Partial<UserSelection>) => void`       | Sets any user's selection fields.                                                |
| `markSaved`            | `() => void`                                            | Rebaselines the dirty hash to the current document.                              |
| `save`                 | `(meta?: { message?: string }) => Promise<void>`        | No-op when clean or without `onSave`; awaits `onSave`, then `markSaved`.         |

| Type                       | Description                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `AddOptions`               | `add`'s options: `parentId`, optional `index`, optional `properties`.                                    |
| `ApplyRemoteResult`        | `{ applied, rejected }`, the ops `applyRemote` accepted/skipped.                                         |
| `ApplyResult`              | `applyOp`'s success shape: `{ nodes, rootId, inverse, schemaVersion }`.                                  |
| `CreateEditorStoreOptions` | Options for `createEditorStore`: `schema`, `initialValue`, `userId?`, `genId?`, `now?`, `getCallbacks?`. |
| `EditorCallbacks`          | `{ onChange?, onSave? }` passed via `getCallbacks()`; `onSave(doc, meta)`.                               |
| `EditorChange`             | The `onChange` payload: `{ ops, version, getDocument }`.                                                 |
| `EditorNode`               | One flat node: `{ id, type, properties, parentId, childIds, v?, meta? }`.                                |
| `EditorNodes`              | `Record<id, EditorNode>`.                                                                                |
| `EditorOp`                 | `add` (a `NodeData` subtree) / `remove` / `move` / `update` / `load` (an `EditorDocument`).              |
| `EditorStore`              | The store's public shape (method-shorthand signatures, bivariant).                                       |
| `EditorStoreState`         | `{ rootId, nodes, selection, history, version, savedVersion, saving }`.                                  |
| `FieldRef`                 | `{ blockId, key }`, what `focus`/`editing` point at.                                                     |
| `HistoryEntry`             | One undo step: `{ ops, inverse, key, at }`.                                                              |
| `UpdateOptions`            | `update`'s options: `{ coalesce? }`.                                                                     |
| `UserSelection`            | One user's `{ selected, hovered, focus, editing }`.                                                      |

## Tests

| File                              | Covers                                                                                                                                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `boundary.test.ts`                | Import boundary: no React, CRDT, rich text library, other editor layer or directive in core; no media import anywhere in the editor; negative cases.                                                                |
| `document/canonical.test.ts`      | `canonicalJson`: key order at every depth, array order, dropped `undefined`, scalars.                                                                                                                               |
| `document/document.type-check.ts` | Compile-time: nested slots and `meta` accepted, functions and `undefined` rejected in `props`, every `Op` shape.                                                                                                    |
| `docs-core.test.ts`               | Every export of the core barrel appears in `reference/react-editor-core.mdx`.                                                                                                                                       |
| `schema/placement.test.ts`        | `getPlacement`/`canPlace`/`allowedChildTypes`: placement semantics table, edge cases with ad-hoc schemas.                                                                                                           |
| `schema/defaults.test.ts`         | `defaultValuesFor`: declared-default-only semantics, `fillDefaults`, fresh-object-per-call.                                                                                                                         |
| `schema/fields.test.ts`           | `componentOf`/`fieldsOf` (aliases), `groupFields`, `paletteItems` (insert permission), `groupPaletteItems`: ordering and grouping rules.                                                                            |
| `store/hash.test.ts`              | `stableHash`: key-order-insensitive, array-order-sensitive, `undefined` dropped, `null` kept.                                                                                                                       |
| `store/serde.test.ts`             | `flattenTree`/`serializeToTree`: shape, root type kept, round-trip, subtree, dangling id, property copies.                                                                                                          |
| `store/ops.test.ts`               | `applyOp`: every op kind, its guards, its inverse, roundtrips, JSON-serialisability.                                                                                                                                |
| `store/store.test.ts`             | `createEditorStore`: actions, placement guards, undo/redo, coalescing, `applyRemote`, selection, save.                                                                                                              |
| `schema/validation.test.ts`       | `isEmptyValue`, per-kind rules, wrapper paths, `validateNode` visibility and publish rules, `validateDocument` structure and Standard Schema (zod, valibot, async), `missingRequired`, text-free validation module. |
| `schema/visibility.test.ts`       | `isFieldVisible` (`hidden`, `when`), `resolveFields`, `createFieldResolver` memoisation, `fieldContextFor` (`providesContext`/`usesContext`).                                                                       |
| `schema/responsive.test.ts`       | `resolveResponsive` mobile first, `resolveLocalized` fallback chain, wrapper detection.                                                                                                                             |
| `schema/json-schema.test.ts`      | `exportJsonSchema`: built-in rules, draft-07, zod converter, valibot without converter, responsive wrapper.                                                                                                         |
| `schema/types.test.ts`            | `defineComponent`/`defineEditorSchema` identity; the schema is plain data apart from functions and validators.                                                                                                      |
| `schema/schema.type-check.ts`     | Compile-time: `InferProps` for every field kind, custom schema output, literal component names.                                                                                                                     |

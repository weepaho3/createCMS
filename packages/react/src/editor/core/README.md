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

| Type                  | Description                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EditorSchema`        | `{ root, components, canPlace?, aliases?, metadata? }`. `canPlace(child, parent, slot)` runs after the slot rules.                                                                                                              |
| `AnyEditorSchema`     | The wide form every runtime helper accepts.                                                                                                                                                                                     |
| `ComponentDef`        | `label`, `description?`, `category?`, `icon?`, `previewImageUrl?`, `version?`, `fields`, `slots?`, `render?`, `resolveFields?`, `resolveData?`, `migrations?`, `validate?`, `permissions?`, `providesContext?`, `usesContext?`. |
| `AnyComponentDef`     | The wide component form.                                                                                                                                                                                                        |
| `ComponentPermission` | `'drag' \| 'duplicate' \| 'delete' \| 'edit' \| 'insert'`; `false` switches the action off for the component.                                                                                                                   |
| `SlotSpec`            | `label?`, `allow?` (wins over `disallow`), `disallow?`, `min?`, `max?`, `defaultValue?`, `accept?(ctx)`.                                                                                                                        |
| `PlaceContext`        | What `accept` receives: `{ childType, parentId, parentType, slot }`.                                                                                                                                                            |
| `NodeInput`           | `{ type, props?, slots? }`: a node to create, used by slot defaults.                                                                                                                                                            |
| `Migration`           | `{ to, up(props, { node }), down? }`: one step of a component's migration chain.                                                                                                                                                |
| `FieldContext`        | What `hidden` predicates and `resolveFields` receive: `{ nodeId, type, context, metadata }`.                                                                                                                                    |

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

`ContextNode` is what `getNode` returns: `{ type, parent: { id } | null, props }`.

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

Placement is checked per slot: a node goes into `{ id, slot }` of a parent,
and each slot carries its own `allow`/`disallow`, `accept`, `min` and `max`.
The store, the palette, the inserter and drag and drop all use `canPlaceIn`.

| Function             | Signature                                                                    | Notes                                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `canPlaceIn`         | `(schema, nodes, childType, parent: SlotRef, { movingId? }?) => PlaceResult` | In order: `unknown-slot`, `self-nesting` (with `movingId`), `not-allowed`, `slot-full`. A node moved within a full slot does not count twice. |
| `allowedChildTypes`  | `(schema, nodes, parent: SlotRef, { movingId? }?) => string[]`               | The types `canPlaceIn` admits, in definition order; `[]` for a full slot.                                                                     |
| `slotAccepts`        | `(schema, parent, slot, spec, childType) => boolean`                         | One slot's `allow` (wins over `disallow`), `disallow`, `accept` and the schema's `canPlace`; no capacity check.                               |
| `slotsOf`            | `(schema, type) => Record<string, SlotSpec>`                                 | The slots a type declares (`'root'` for the root); `{}` when none.                                                                            |
| `isSelfOrDescendant` | `(nodes, id, candidate) => boolean`                                          | `candidate` is `id` or lives below it, in any slot.                                                                                           |
| `DEFAULT_SLOT`       | `'children'`                                                                 | The slot createcms trees use and the default for every `slot?` option.                                                                        |

`min` is a validation rule, not a placement rule: an empty slot below its
`min` is reported by `validateDocument`, never refused by the store.

| Type             | Description                                                                     |
| ---------------- | ------------------------------------------------------------------------------- |
| `PlaceResult`    | `{ ok: true }` or `{ ok: false, code: PlaceErrorCode }`.                        |
| `PlaceErrorCode` | `'unknown-slot' \| 'self-nesting' \| 'not-allowed' \| 'slot-full'`.             |
| `PlacementNode`  | What placement reads from a node: `{ type, parent, slots }`; a `FlatNode` fits. |

## Copying subtrees

`remapIds(subtree, genId, options?)` returns `{ node, map }`: a copy with a
fresh id for every node in every slot and the old-to-new id map. With a
`schema`, ids inside props that point into the copied subtree are rewritten
too: a `link` field's `fragment` by default (recursing through `list` and
`object`), any field through its own `rewriteRefs(value, map)`. References to
nodes outside the subtree stay as they are. `duplicate` uses it.

| Name              | Description                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `RemapIdsOptions` | `{ schema?, rewriteRefs? }`; `rewriteRefs` replaces the per-field rewrite for every field. |
| `RewriteRefs`     | `(value, map, field) => JsonValue`: return the value unchanged when it holds no ids.       |

## Validation

Validation returns codes, paths and params, never text; map the codes to your
own messages (`formatIssue(issue, messages?)` formats them from the message
catalog, English by default). Three layers: structure, the built-in rules of every field, then
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

## Messages

`Messages` is the text catalog of the editor: `field` and `structure` (one
function per validation code), `schema`, `parts` (labels of the parts),
`commands` (labels by command id), `announce` (live region texts, naming an
`AnnouncedBlock` `{ label, excerpt }`) and `keys` (`KeyNames` per
`Platform`, `apple` or `other`). `EN_MESSAGES` is the English catalog;
`mergeMessages(base, ...partials)` merges `MessagesInput` catalogs deeply,
later ones winning. A full `Messages` must name every entry, so a translation
typed as `Messages` cannot miss one.

| Function                                          | Notes                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `formatIssue(issue, messages?)`                   | A `FieldError` or `ValidationIssue` as text.                       |
| `formatShortcut(combo, { platform?, messages? })` | `Mod+Shift+z` as `⌘⇧Z` (Apple) or `Ctrl+Shift+Z`.                  |
| `ariaKeyShortcut(combo, platform?)`               | The `aria-keyshortcuts` value (`Meta+Shift+Z`, `Control+Shift+Z`). |
| `detectPlatform()`                                | `apple` on macOS and iOS, `other` elsewhere and outside a browser. |

## Loading documents

`loadDocument(input, schema, { genId })` is the load pipeline the store runs
on `initialValue` and every `load`. It returns `LoadResult` `{ doc,
diagnostics }`:

- renamed types go through `schema.aliases` (`alias`),
- each node runs its component's `migrations` step by step until `v`
  reaches `version` (`migrated`; `migration-missing` or `migration-failed`
  stop at the last good step). A step returns the new props, or
  `{ props, slots?, type? }`,
- duplicate ids get fresh ones (`duplicate-id`),
- props of the wrong type fall back to their default (`invalid-prop`, the old
  value is kept in the diagnostic),
- nodes without an id or type are left out (`invalid-node`),
- unknown types are reported (`unknown-type`) and kept as stored.

Nothing changes silently: every change is a `Diagnostic` `{ code, severity,
path, message, value? }` (`DiagnosticCode`). The store reports them through
`createEditorStore({ onDiagnostics })` and the `diagnostics` event. An input
without a root throws `DocumentLoadError`.

## Computed data

A component's `resolveData({ id, props }, ctx)` computes display values (a
fetched title, a price). It runs on load, on insert, on a change of the
node's props (`ctx.changed` lists the keys) and on `store.resolveData(id)`
(`force`); `ResolveDataContext` is `{ trigger, changed, signal, metadata }`.
Results live in `session.computed[id]` and render on top of the stored props;
they never enter the document. While a promise runs,
`session.nodeStatus[id]` is `NodeStatus` `{ loading: true, error: null }`; a
failure keeps `error`. A newer run aborts the older one through
`ctx.signal`, and only the newest result lands.

## Editor codes

Warnings and errors carry a code, `[editor:E005] ...`, with a link to
[Editor codes](/docs/reference/editor-errors). `EDITOR_CODES` lists them
(`EditorCode`), `EDITOR_CODES_URL` is that page, `formatEditorMessage(code,
message)` builds the text. `warnOnce(code, message)` prints a warning once;
call it behind `process.env.NODE_ENV !== 'production'` so production builds
drop the text. `resetWarnings()` forgets printed warnings (tests).

## Worker tasks

`createWorkerTasks({ schema, worker?, threshold? })` returns `WorkerTasks`:
`validateDocument(doc, options?)`, `mergeByNode(base, local, server)` and
`dispose()`. With a `worker` (any `WorkerPort`: a `Worker`, a `MessagePort`),
documents of at least `threshold` nodes (default `WORKER_THRESHOLD`, 500) are
validated and merged on the worker; smaller ones, and every call without a
worker, run on the main thread. The worker script calls
`serveWorkerTasks(self, { schema })` with the same schema, because schemas
carry functions and cannot be posted. The store itself stays on the main
thread.

## Store

`createEditorStore(options)` builds the editor store over a `DocStore`. State
lives in three scopes with their own listener channels, so hover never wakes
a component that reads the document:

| Scope     | Getter / subscribe                      | Holds                                                                                                                                                                                                                                    |
| --------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Document  | `getDoc()` / `subscribeDoc`             | `DocState`: `{ rootId, nodes, version, schemaVersion }`. Undoable and persisted.                                                                                                                                                         |
| Session   | `getSession()` / `subscribeSession`     | `SessionState`: `selection` (ids, first is primary), `focusedField`, `editing`, `mode`, `history` flags, `save` state, `computed` and `nodeStatus` (`resolveData`), `collapsed` (outline rows; selecting a block expands its ancestors). |
| Ephemeral | `getEphemeral()` / `subscribeEphemeral` | `EphemeralState`: `hoverId`.                                                                                                                                                                                                             |

Every getter returns the same object until its scope changes. Nodes keep
every slot they hold; a node added through `add` holds every slot its type
declares, filled from the slot's `defaultValue` with fresh ids.

| Option            | Notes                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| `schema`          | The editor schema; plugins add blocks and field kinds (`store.schema` is the result, `store.sourceSchema` the input). |
| `initialValue`    | The document, unless `docStore` is given.                                                                             |
| `docStore`        | A document store to write through (default: `createJsonDocStore`).                                                    |
| `genId`           | Id generator for new blocks (default `createBlockId`: `blk_` + 20 chars).                                             |
| `now`             | Clock for history merging (default `Date.now`).                                                                       |
| `maxHistory`      | Undo steps kept (default `MAX_HISTORY`, 200).                                                                         |
| `remotePlacement` | `accept-and-warn` (default: apply, emit `diagnostic`) or `reject` for remote ops that break placement.                |
| `persistence`     | `PersistenceOptions`: how and when to save.                                                                           |
| `plugins`         | `EditorPlugin[]`.                                                                                                     |
| `timers`          | `Timers` (`setTimeout`/`clearTimeout`), injectable for tests.                                                         |

| Method                                               | Notes                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `getDocument()`                                      | The nested document, memoised per version.                                                              |
| `isDirty()`                                          | Local changes the last save did not include (an undo counts as a change).                               |
| `dispatch(cmd)`                                      | Runs a command through the pipeline; `DispatchResult` is `{ ok: true, ops }` or `{ ok: false, error }`. |
| `transact(fn, { label }?)`                           | Every command `fn` dispatches becomes one undo step; a throw reverts them all.                          |
| `use(middleware, { priority }?)`                     | Adds a middleware; returns a remove function.                                                           |
| `handle(type, handler)`                              | Registers a command handler; returns an unregister function.                                            |
| `on(event, handler)` / `onBeforeCommand`             | Event subscription (`EditorEvents`) and the cancel/replace hook; both return an unsubscribe function.   |
| `load(doc, { baseVersion }?)`                        | Replaces the document; clears history and selection, marks it saved.                                    |
| `add(type, { parent, index?, props? })`              | `node.insert`; returns the new id or `null`.                                                            |
| `update(id, patch, { coalesce }?)`                   | `node.update` (merge patch, `null` deletes); `coalesce` merges a typing run into one undo step.         |
| `move(id, { parent, index })`                        | `node.move`; `false` on the root or when refused.                                                       |
| `remove(id)` / `duplicate(id)`                       | `node.remove` / `node.duplicate` (`remapIds`, right after the original).                                |
| `wrap(id, type, { slot?, props? }?)`                 | `node.wrap`: the node moves into a new `type` node at its place.                                        |
| `applyRemote(ops)`                                   | Ops from elsewhere: no undo step, no autosave; returns `ApplyRemoteResult` `{ applied, rejected }`.     |
| `undo()` / `redo()`                                  | Restores the selection of the step; `false` when there is nothing to undo or redo.                      |
| `mark()` / `squash(mark, { label }?)` / `bail(mark)` | Live writes: collect from `mark`, fold into one step or revert without one.                             |
| `select(id)` / `setSelection(ids)`                   | Session selection; a change ends the typing merge.                                                      |
| `hover(id)`                                          | Ephemeral; never wakes document or session readers.                                                     |
| `focus(ref)` / `setEditing(ref)` / `setMode(mode)`   | Session state; focus and editing end the typing merge.                                                  |
| `setCollapsed(id, collapsed)`                        | Collapses or expands a block's outline row.                                                             |
| `save({ message?, force? }?)`                        | Saves now when dirty (or forced); resolves when that save settled.                                      |
| `reloadFromServer()`                                 | Loads the server document of the current conflict; `false` without one.                                 |
| `commands`                                           | UI commands: `get`, `list`, `execute`, `canExecute`, `shortcuts()` (combo to command id).               |
| `destroy()`                                          | Stops timers and drops every listener.                                                                  |

`createBlockId` mints ids. `applyOp` applies one op purely and returns
`ApplyResult` `{ nodes, rootId, inverse, schemaVersion }`. `normalize` and
`denormalize` convert a whole document between nested and flat form;
`flattenSubtree(node, parent)` and `serializeSubtree(nodes, id, slotOrder?)`
do the same for one subtree. Serialised slots come in `slotOrder` order
(declared slots first, then the rest alphabetically), and empty slots are
kept.

## Commands and middleware

Every document write is a `Command` `{ type, payload, meta? }`. `dispatch`
runs it as: `onBeforeCommand` handlers (`false` cancels, a command replaces
it), then middlewares by descending priority, then the type's handler, which
turns the payload into ops. The placement middleware (`placementMiddleware`,
priority `PLACEMENT_PRIORITY`) runs innermost and refuses local ops that
`canPlaceIn` rejects. The doc store applies the ops all or nothing. Any throw
leaves every scope unchanged and reports an `EditorError` through
`opRejected` and `error`.

`CommandMeta`: `history` (`record`, `ignore`, `merge`), `mergeKey`, `origin`
(`local` by default), `label`.

| Built-in (`BUILTIN_COMMANDS`) | Payload                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `node.insert`                 | `InsertPayload`: `{ type, parent, index?, props? }`                                          |
| `node.insertNode`             | `InsertNodePayload`: `{ parent, index?, node }` (ids kept)                                   |
| `node.remove`                 | `RemovePayload`: `{ id }`                                                                    |
| `node.move`                   | `MovePayload`: `{ id, parent, index }`                                                       |
| `node.update`                 | `UpdatePayload`: `{ id, patch }`                                                             |
| `node.duplicate`              | `DuplicatePayload`: `{ id }`                                                                 |
| `node.wrap`                   | `WrapPayload`: `{ id, type, slot?, props? }`                                                 |
| `node.detach`                 | `DetachPayload`: `{ id, nodes }`: replaces a `$ref` node with copies (fresh ids) in one step |
| `node.paste`                  | `PastePayload`: `{ parent, index?, nodes }` (every id replaced; unknown types refused)       |
| `doc.replace`                 | `ReplacePayload`: `{ doc }`                                                                  |

`BuiltinCommandPayloads` maps each type to its payload. `checkPlacement(schema,
state, ops)` is the placement check over a list of ops; `PlacementError`
carries its `code`.

| Type                   | Description                                                                                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Middleware`           | `(ctx: CommandContext, next) => Op[]`: call `next` to continue, throw to refuse.                                                                                                                                                             |
| `CommandContext`       | `{ cmd, getState, schema }`.                                                                                                                                                                                                                 |
| `CommandHandler`       | `(payload, ctx: HandlerContext) => Op[]`.                                                                                                                                                                                                    |
| `HandlerContext`       | `{ getState, schema, genId, select(ids) }`; `select` sets the selection after commit.                                                                                                                                                        |
| `BeforeCommandHandler` | `(cmd) => Command \| false \| void`.                                                                                                                                                                                                         |
| `EditorError`          | `{ kind: EditorErrorKind, message, code?, cmd?, cause? }`.                                                                                                                                                                                   |
| `EditorErrorKind`      | `'command' \| 'unknown-command' \| 'placement' \| 'rejected' \| 'cancelled'`.                                                                                                                                                                |
| `EditorEvents`         | `change`, `afterCommand`, `opRejected`, `historyInvalidated`, `diagnostic`, `select`, `beforeSave`, `afterSave`, `saveError`, `error`, `diagnostics`, `history` (undo or redo applied), `ui` (`{ action: UiAction }` from a `ui.*` command). |
| `UiAction`             | `'commandPalette' \| 'quickInsert' \| 'toolbar' \| 'shortcutHelp'`.                                                                                                                                                                          |
| `EditorEventName`      | A key of `EditorEvents`.                                                                                                                                                                                                                     |
| `EditorChange`         | The `change` payload: `{ ops, origin, version, getDocument }`.                                                                                                                                                                               |
| `EditorCommand`        | A UI command: `{ id, label?, editable?, native?, run(store, args?), canExecute? }`. `editable`: its shortcuts also fire inside inputs and editable text. `native`: the browser's own event runs it from the keyboard.                        |

Built-in UI commands (labels from the catalog's `commands`):

| Command                                                                | Does                                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `history.undo`, `history.redo`                                         | Undo, redo (`editable`).                                                                 |
| `block.remove`                                                         | Removes the primary selection and selects its neighbour.                                 |
| `block.duplicate`                                                      | Duplicates the primary selection and selects the copy.                                   |
| `block.moveUp`, `block.moveDown`                                       | Moves the primary selection among its siblings.                                          |
| `block.wrap`                                                           | Wraps the primary selection in `args.type`, else the first type that fits and takes it.  |
| `selection.parent`                                                     | Selects the parent; clears at the top level.                                             |
| `selection.firstChild`                                                 | Selects the first child (declared slots first).                                          |
| `selection.next`, `selection.previous`                                 | Selects the next or previous sibling.                                                    |
| `selection.siblings`                                                   | Selects the primary selection and all its siblings.                                      |
| `clipboard.copy`, `.cut`, `.paste`                                     | Blocks through the async Clipboard API; `native`, so the keyboard uses clipboard events. |
| `clipboard.copyProps`, `clipboard.pasteProps`                          | Props of one block onto selected blocks of the same type.                                |
| `ui.commandPalette`, `ui.quickInsert`, `ui.toolbar`, `ui.shortcutHelp` | Emit the `ui` event for the editor chrome (`ui.toolbar` is `editable`).                  |

`DEFAULT_SHORTCUTS` binds them: `Mod+z`, `Mod+Shift+z`, `Ctrl+y`, `Mod+c`,
`Mod+x`, `Mod+v`, `Mod+Alt+c`, `Mod+Alt+v`, `Mod+d`, `Mod+Shift+d`,
`Delete`, `Backspace`, `Alt+ArrowUp`, `Alt+ArrowDown`, `Mod+g`, `Escape`,
`Shift+Enter`, `Enter`, `Tab`, `Shift+Tab`, `Mod+a`, `Mod+k`, `/`,
`Alt+F10`, `?` and `Mod+/`. A plugin's `shortcuts` replace a default
binding; an empty id unbinds it.

## Insertion points

`insertionPoints(schema, nodes, rootId, type, movingId?)` lists every
`InsertionPoint` (`{ parent, index }`) where a block of `type` may go, in
document order: each slot that takes it contributes its gaps, and a
child's own slots follow the gap before it. With `movingId`, places inside
that block are left out and its own slot counts it as gone. Keyboard drags
step through this list; `useMoveTargets` groups it by slot.

## Clipboard

Blocks travel as a `ClipboardPayload` (`{ app: CLIPBOARD_APP, version:
CLIPBOARD_VERSION, kind: 'blocks', blocks }` or `kind: 'props'` with `type`
and `props`). Copy writes `text/html` that carries the payload base64-encoded
in a `CLIPBOARD_ATTRIBUTE` attribute around readable text, plus
`text/plain`; that path works in every engine without a permission prompt.
The async path also writes `CLIPBOARD_MIME` where `ClipboardItem.supports`
accepts it. Paste reads the custom format, then the HTML attribute, then
hands foreign content to the plugins' `convertForeignPaste`. Pasted blocks
always get fresh ids and pass the schema and placement rules; a refused
paste emits `opRejected`.

| Function                                      | Notes                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `copyBlocks(store)`                           | The selected blocks (outermost only, document order) as a payload, or `null`.           |
| `copyProps(store)`                            | The primary selection's props as a payload, or `null`.                                  |
| `removeSelected(store)`                       | Removes the selected blocks in one undo step (the cut half).                            |
| `pasteTarget(store)`                          | Into the selected block when its first slot is empty, else after it, else the root end. |
| `pasteBlocks(store, payload)`                 | Inserts with fresh ids at `pasteTarget`; returns the new ids, empty when refused.       |
| `pasteProps(store, payload)`                  | Applies copied props to selected blocks of the same type.                               |
| `encodeClipboardHtml(payload, text?)`         | The `text/html` carrier.                                                                |
| `decodeClipboard({ json?, html? })`           | The payload from the custom format or the HTML attribute, else `null`.                  |
| `parseClipboardPayload(value)`                | `value` when it is a well-formed payload, else `null`.                                  |
| `plainTextOf(blocks)`                         | The blocks' string props, depth first, one per line.                                    |
| `writeClipboard(payload)` / `readClipboard()` | The async Clipboard API path; `false` / `null` without the API or permission.           |

## Document store and history

`DocStore` is what the editor writes through: `getSnapshot`, `subscribe`
(`Change[]` and the `Origin`), `transact(fn, meta?)` with a `Tx` (`insertNode`,
`removeNode`, `moveNode`, `setProp(id, path, value)`, `replaceDocument`,
`apply(op)`), and the history methods `undo`, `redo`, `canUndo`, `canRedo`,
`mark`, `squash`, `bail`, `breakMerge`, `clearHistory`, `getHistory`. A
transaction that fails throws `TxRejectedError` and changes nothing.
`createJsonDocStore(options)` is the single-user implementation
(`CreateJsonDocStoreOptions`: `initialValue`, `now?`, `mergeMs?`,
`maxEntries?`); a collaborative store implements the same interface.

History rules of `JsonDocStore`:

- Steps with the same `mergeKey` within `MERGE_MS` (400 ms, sliding) become
  one; another key, `breakMerge` (selection, focus) or an unkeyed step ends
  the merge.
- At most `MAX_HISTORY` (200) steps; the oldest goes first.
- `undo` applies the inverses with origin `history` and returns the
  `HistoryStep` (`ops`, `label?`, `selection` to restore); `redo` likewise.
- `mark` collects every local change (recorded or `history: 'ignore'`);
  `squash` folds them into one step, `bail` reverts them without one.
- A remote change drops the undo steps it conflicts with (same node
  structurally, same slot order, same prop, or a removed node whose props a
  step writes), so an undo never fails silently. Writes to different props of
  one node do not conflict.

| Type           | Description                                                                 |
| -------------- | --------------------------------------------------------------------------- |
| `DocState`     | `{ rootId, nodes, version, schemaVersion }`.                                |
| `Tx`           | The writes of one transaction.                                              |
| `TxMeta`       | `{ origin?, history?, mergeKey?, label?, selection? }`.                     |
| `TxResult`     | `{ ops, inverse, invalidated }`.                                            |
| `Change`       | `{ kind: 'node' \| 'props' \| 'placement', id, keys? }`.                    |
| `HistoryEntry` | `{ ops, inverse, mergeKey?, at, selectionBefore, selectionAfter, label? }`. |
| `HistoryStep`  | What `undo`/`redo` applied.                                                 |
| `MarkId`       | Opaque handle of a mark.                                                    |

## Saving

With `persistence`, the store saves through `persistence.save(doc, { ops,
baseVersion?, force?, message?, phase })`, which resolves `{ version }`.
`phase` is a `SavePhase`: `autosave`, `save` (`store.save()`) or `publish`
(`store.save({ phase: 'publish' })`). Autosave
(on unless `autosave: false`) waits `SAVE_DEBOUNCE_MS` (1500) after the last
change and saves at least every `SAVE_MAX_WAIT_MS` (10000). Never two saves at
once: a save requested during one runs right after it. `ops` are the local ops
since the last successful save; `baseVersion` is the version that save
returned (first `persistence.baseVersion`). Remote ops are never saved.

Failures: an `EditorAdapterError` of kind `conflict` sets status `conflict`
with `SaveConflict` `{ serverDoc, serverVersion }` from the error's
`details`, and autosave pauses until `reloadFromServer()` or
`save({ force: true })`; kind `network` retries after `SAVE_RETRY_BASE_MS`,
doubling up to `SAVE_RETRY_MAX_MS`; anything else sets `error` without a
retry. Local changes are never lost.

Before every save the `beforeSave` gates run (`createEditorStore`'s or
`Editor.Root`'s, then each plugin's): a `BeforeSaveGate` receives `{ doc,
ops, phase, schema }` and returns issues, or a promise of them. Any issue
blocks the save: status `invalid`, `SaveState.issues` holds them (shown by
`Editor.ErrorSummary`), nothing is sent and the changes stay dirty.
`requireValidDocument({ phases? })` is the gate that blocks on
`validateDocument` errors (warnings pass) for `save` and `publish`, so
autosave keeps storing drafts; `publish` validates with the publish phase.

`mergeByNode(base, local, server, { slotOrder }?)` merges three documents per
node id: a node changed on one side takes that side, the same change on both
is fine, different changes on both are conflicts. It returns `MergeResult`:
`{ ok: true, doc }` or `{ ok: false, conflicts }`.

| Type                 | Description                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| `PersistenceOptions` | `{ save, baseVersion?, autosave? }`.                                     |
| `SaveState`          | `{ status: SaveStatus, dirty, error, conflict, version, issues }`.       |
| `SaveStatus`         | `'idle' \| 'saving' \| 'error' \| 'conflict' \| 'invalid'`.              |
| `SavePhase`          | `'autosave' \| 'save' \| 'publish'`.                                     |
| `BeforeSaveGate`     | `({ doc, ops, phase, schema }) => issues \| void`, or a promise of that. |
| `SaveConflict`       | `{ serverDoc, serverVersion }`.                                          |
| `Timers`             | `{ setTimeout, clearTimeout }`.                                          |

## Sections

A reusable section is a `$ref` node (`REF_TYPE`) with props `ref` (a
`SectionRef` `{ collection, id }`) and `overrides` (`SectionOverrides`:
props per node id of the referenced document). Overrides apply only to the
props a component lists in `exposedProps`; everything else stays as the
section has it. `sectionsPlugin({ resolver, label? })` adds the `$ref`
block (`sectionBlock`) and the `block.detach` command.

`createSectionResolver({ resolveReference, schema, maxDepth? })` returns a
`SectionResolver`: `resolve(ref, overrides?)` fetches through
`resolveReference` (an adapter's, cached per reference), returns the
referenced root's children as a `ResolvedSection` `{ nodes, diagnostics }`
and expands nested references up to `maxDepth` (`REF_MAX_DEPTH`, 3). A
cycle, the depth limit or a failed fetch ends that branch with a
`reference-cycle`, `reference-depth` or `reference-missing` diagnostic;
`invalidate(ref?)` drops cached documents.
`detachSection(store, id, resolver)` replaces a `$ref` node with an
editable copy of its section (fresh ids, overrides applied) as one undo
step. `applyOverrides(nodes, overrides, schema)`, `sectionRefOf(node)` and
`sectionOverridesOf(node)` are the pieces it uses.

## Plugins

`defineEditorPlugin(plugin)` declares an `EditorPlugin`: `name` (unique),
`fields` (`PluginFieldKind` per `custom` kind: `validate` for fields without a
`schema`, `control` for the form), `blocks` (added to the schema, schema
components win), `commands` (`PluginCommand`: `label?`, `run`,
`canExecute?`), `shortcuts` (combo to command id), `on`
(`PluginEventHandlers`: any `EditorEvents` handler plus `beforeCommand`),
`slots` (UI outlets, rendered by `Editor.Slot`), `messages` (catalog
entries), `beforeSave` (a save gate), `convertForeignPaste` (pasted foreign `html`/`text` to blocks),
`priority` (higher first).
Pass plugins to `createEditorStore` or `Editor.Root`.

| Function                                     | Notes                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `sortPlugins(plugins)`                       | Apply order (descending `priority`, stable); throws on a duplicate name (`[editor:E002]`). |
| `applyPlugins(schema, plugins)`              | The schema with plugin blocks and field kind validators; `schema` itself when none apply.  |
| `pluginCommands(plugins)`                    | The plugins' commands by id (an earlier plugin wins).                                      |
| `pluginShortcuts(plugins, base, onConflict)` | Combo to command id; the store reports conflicts as `[editor:E003]` warnings.              |
| `normalizeCombo(combo)`                      | Lower case, `mod` for Cmd/Meta, modifiers in a fixed order.                                |

## Types

| Type                       | Description                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `AddOptions`               | `add`'s options: `parent: SlotTarget`, optional `index`, optional `props`.                            |
| `ApplyRemoteResult`        | `{ applied, rejected }`.                                                                              |
| `ApplyResult`              | `applyOp`'s success shape: `{ nodes, rootId, inverse, schemaVersion }`.                               |
| `CreateEditorStoreOptions` | The options above.                                                                                    |
| `EditorMode`               | `'form' \| 'visual'`.                                                                                 |
| `EditorNodes`              | `Record<id, FlatNode>`, the node table.                                                               |
| `EditorStore`              | The store's public shape (method-shorthand signatures, bivariant).                                    |
| `EphemeralState`           | `{ hoverId }`.                                                                                        |
| `FieldRef`                 | `{ blockId, key }`, what `focus`/`editing` point at.                                                  |
| `MoveTarget`               | `move`'s target: `{ parent: SlotTarget, index }`; the index counts after the node left its old place. |
| `SessionState`             | The session scope.                                                                                    |
| `NodeStatus`               | `{ loading, error }`: one node's `resolveData` state.                                                 |
| `SlotOrder`                | `(type) => readonly string[]`: the slot order serialisation uses for a type.                          |
| `SlotTarget`               | `{ id, slot? }`: a parent and one of its slots; `slot` defaults to `children`.                        |
| `UpdateOptions`            | `update`'s options: `{ coalesce? }`.                                                                  |

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

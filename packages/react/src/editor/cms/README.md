# CMS adapter (`@createcms/react/editor/cms`)

Optional adapter between the editor primitive and a createcms collection
client. Consumers with their own data layer can skip this entry.

## Usage

```tsx
const doc = useCmsDocument({
  client: cmsClient.pages,
  rootId,
  branchId,
  message: () => commitMessageRef.current,
  templates: cmsClient.templates,
  collection: 'pages',
});

<pageEditor.Root
  key={doc.key}
  defaultValue={doc.tree}
  onSave={doc.save}
  onChange={doc.onChange}
>
  <Canvas.Root resolve={doc.resolve} />
</pageEditor.Root>;
```

Wire `onChange={doc.onChange}` so `resolveTree` sees unsaved edits.

## Client shape

The hook duck-types four collection methods with the live proxy envelope:
`getBlockTree({ query })`, `getBranch({ query })`,
`updateBlocks({ body })`, and `resolveTree({ body })`. `getBranch` is
required because `getBlockTree` does not return `headCommitId`.

The createcms client proxy mints a new object on every property access.
Pass `client` once; the hook captures it in a ref on the first render.

## Status

| Status     | Meaning                              |
| ---------- | ------------------------------------ |
| `loading`  | Initial load or `reload()` in flight |
| `idle`     | Tree ready                           |
| `saving`   | `updateBlocks` in flight             |
| `conflict` | `HEAD_MISMATCH` (branch advanced)    |
| `error`    | Other save or load failure           |

On conflict, call `reload()` to fetch the latest head or
`save({ force: true })` to overwrite without a head check.

## Errors

`error.fields` is `{ blockId, key, message }[]` for server-side
`TYPE_MISMATCH` issues. Render it in editor chrome. `Editor.FieldError`
still shows client-side `validateField` findings only.

## Templates

When `templates` and `collection` are set, `onAdd(blockType)` calls
`getTemplateDefaults` and returns the defaults object for merging into
`store.add` / `AddBlock`.

No `@createcms/core` import: types come from `@createcms/schema` only.

## Field sources

Registry controls for `image`, `reference`, `link`, and `{{variable}}`
suggest call `useCmsFieldSources(cmsClient)` with the **top-level**
createcms client (not a collection namespace).

```tsx
const sources = useCmsFieldSources(cmsClient);
const suggest = useVariableSuggest(sources);
```

Pass `client` once; the hook captures it in a ref on the first render,
same as `useCmsDocument`.

### Return value

| Member                                          | Role                                                       |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `assets.list(query?)`                           | Media library listing (`listAssets({ query })`)            |
| `assets.get(ids)`                               | Batch asset lookup by id (`getAssets({ query: { ids } })`) |
| `assets.useUpload()`                            | React hook wrapping `media.useUploadAssets()` when present |
| `roots.list(collection, query?)`                | Collection root listing                                    |
| `roots.get(collection, rootId)`                 | Single root by id                                          |
| `roots.bySlug(collection, slug, parentRootId?)` | Draft slug lookup                                          |
| `variables.list(query?)`                        | Site variables                                             |
| `templates.defaults(collection, blockType)`     | Block template defaults                                    |

### Proxy envelope

Live client calls use `{ query }` / `{ body }`, not flattened JSDoc
examples:

```ts
sources.assets.list({ limit: 20, cursor });
cmsClient.media.listAssets({ query: { limit: 20, cursor } });
```

### Cache

Per-hook, in-memory only: successful responses and in-flight promises
are keyed by operation and arguments (stable JSON). Failed requests are
not cached. `assets.list` and `roots.list` also populate id caches used
by `get`.

### `assetUrl`

Build the status-gated media URL for content and canvas (not the direct
`AssetListItem.url`):

```ts
assetUrl(assetId, { format: 'webp', w: 800 });
// /api/cms/media/asset/<id>?format=webp&w=800
```

### Labels

`referenceLabel(collection, rootId, sources)` and
`linkLabel(linkValue, sources)` resolve display names from root
properties (`title`, `label`, `name`, then slug, path, id). Internal
link labels ignore `fragment` and `query`. Failed root lookups fall back
to the raw id.

### `useVariableSuggest`

Loads variables (paged, up to 1000 offset) and exposes a suggest object
for `Canvas.InlineText` or form controls. Pattern: `/\{\{(\w*)$/`.
`getItems` filters loaded keys by prefix; accept inserts `{{key}}`.

`assets.useUpload()` is a nested React hook: call it at component top
level, not inside callbacks.

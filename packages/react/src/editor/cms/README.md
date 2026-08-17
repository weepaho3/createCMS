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

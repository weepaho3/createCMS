# Media (`@createcms/react/media`)

Headless media library primitive: folder navigation, paged asset listing,
search, sort, selection, bulk mutations and uploads over a createcms React
client. Unstyled; styling happens in the consumer's wrapper components
(registry).

## Usage

`Media.Root` owns the store and takes `cmsClient.media`. Parts render
unstyled elements with `data-*` state; the list parts take a render
function per entry.

```tsx
import { Media } from '@createcms/react/media';

import { cmsClient } from './cms-client';

function MediaLibrary({ onPick }: { onPick: (ids: string[]) => void }) {
  return (
    <Media.Root
      client={cmsClient.media}
      selection="multiple"
      onSelectionChange={onPick}
    >
      <Media.Breadcrumbs>
        {(path) => (
          <>
            <Media.Crumb folder={null}>Library</Media.Crumb>
            {path.map((folder) => (
              <Media.Crumb key={folder.id} folder={folder} />
            ))}
          </>
        )}
      </Media.Breadcrumbs>
      <Media.Search placeholder="Search" />
      <Media.FolderList>
        {(folder) => <Media.Folder key={folder.id} folder={folder} />}
      </Media.FolderList>
      <Media.Grid>
        {(asset) => (
          <Media.Item key={asset.id} asset={asset}>
            <Media.Thumbnail fallback={<span>{asset.mimeType}</span>} />
            <span>{asset.slug}</span>
          </Media.Item>
        )}
      </Media.Grid>
      <Media.Empty>No assets yet.</Media.Empty>
      <Media.Error>
        {({ retry }) => <button onClick={retry}>Could not load, retry</button>}
      </Media.Error>
      <Media.LoadMore>Load more</Media.LoadMore>
      <Media.Dropzone accept="image/*" maxFiles={10}>
        {({ dragActive, uploading }) =>
          uploading
            ? 'Uploading…'
            : dragActive
              ? 'Release'
              : 'Drop or pick files'
        }
      </Media.Dropzone>
      <Media.UploadList>
        {(entry) => (
          <Media.UploadItem key={entry.id} entry={entry}>
            {entry.name}
            <Media.UploadProgress />
          </Media.UploadItem>
        )}
      </Media.UploadList>
      <Media.UploadAbort>Cancel</Media.UploadAbort>
      <Media.UploadClear>Clear</Media.UploadClear>
    </Media.Root>
  );
}
```

`client` is read once at mount: `Media.Root` calls `client.useUploadAssets()`
as a hook on every render and the store keeps the first client it saw.
Render with a different `key` to swap clients. `defaultFolderId`,
`selection` and `pageSize` are read once at mount too; `onSelectionChange`
and `assetUrl` are read fresh on every call.

## Client shape

`MediaClient` duck-types the media surface of the React client with the live
proxy envelope: `listAssets({ query })`, `listFolders({ query })`,
`createFolder({ body })`, `moveAssets({ body })`, `archiveAssets({ body })`,
`updateAssetsStatus({ body })` and the `useUploadAssets()` hook.

## Folders and breadcrumbs

The root level (`folderId: null`) lists unfiled assets and the top-level
folders. `navigate(folder)` pushes a child of the current folder onto
`path`, truncates `path` after a folder that is already in it, and clears
`path` for `null`; a folder that is neither in `path` nor a child of the
current folder starts a new `path = [folder]`. Navigating resets search,
selection and the cursor.

A `defaultFolderId` has no known ancestry: the store starts with
`path = []` and `folderId = defaultFolderId`, and `Media.Breadcrumbs` hands
its children one crumb for the current folder named `…`. Navigating into a
child keeps that `…` entry in `path` ahead of the child; the name becomes
known once the user navigates from a listed parent. There is no rename and
no get-folder-by-id endpoint.

## Parts

| Part                   | Default element                                | Props                                                                                                                 | Data attributes / ARIA                                                                                                |
| ---------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Media.Root`           | none (provider)                                | `client` (required), `defaultFolderId`, `selection`, `pageSize`, `onSelectionChange`, `assetUrl`, `children`          | none                                                                                                                  |
| `Media.Grid`           | `ul`                                           | `children(asset)` (required), `render`, ul props                                                                      | `data-status`, `data-empty`; `role="listbox"` + `aria-multiselectable` with a selection mode, `role="list"` otherwise |
| `Media.Item`           | `li`                                           | `asset` (required), `render`, li props                                                                                | `data-selected`, `data-asset-status`, `data-type`; in a listbox `role="option"`, `aria-selected`, roving `tabIndex`   |
| `Media.Thumbnail`      | `img` (`loading="lazy"`, `decoding="async"`)   | `fallback`, `render`, img props (`alt` defaults to the slug)                                                          | `data-loaded`, `data-error`; renders `fallback` for non-images                                                        |
| `Media.Breadcrumbs`    | `nav[aria-label="Folder path"]`                | `children(path)` (required), `render`, nav props                                                                      | none                                                                                                                  |
| `Media.Crumb`          | `button`                                       | `folder` (required, `null` = root), `render`, button props (`children` defaults to the name or `Root`)                | `data-current`, `aria-current="page"` on the current folder                                                           |
| `Media.FolderList`     | `ul`                                           | `children(folder)` (required), `render`, ul props                                                                     | `data-empty`                                                                                                          |
| `Media.Folder`         | `button`                                       | `folder` (required), `render`, button props (`children` defaults to the name)                                         | none                                                                                                                  |
| `Media.Search`         | `input[type="search"]`                         | `render`, input props (`aria-label` defaults to `Search assets`)                                                      | none                                                                                                                  |
| `Media.LoadMore`       | `button`                                       | `render`, button props                                                                                                | `data-has-more`, `data-loading`; `disabled` without a cursor or while loading                                         |
| `Media.Empty`          | `div`, rendered while idle with nothing listed | `render`, div props                                                                                                   | none                                                                                                                  |
| `Media.Error`          | `div[role="alert"]`, rendered on a list error  | `children({ error, retry })` (required), `render`, div props                                                          | none                                                                                                                  |
| `Media.MutationError`  | `div[role="alert"]`, rendered on a failed bulk | `children({ error, dismiss })` (required), `render`, div props                                                        | none                                                                                                                  |
| `Media.Dropzone`       | `button` + hidden file input + polite `output` | `accept`, `maxFiles` (10), `maxSize`, `folderId`, `onUploaded`, `onRejected`, `children` (node or function), `render` | `data-drag-active`, `data-uploading`, `data-disabled`; `aria-disabled` while uploading, `aria-describedby` summary    |
| `Media.UploadList`     | `ul` + hidden `role="log"`                     | `children(entry)` (required), `render`, ul props                                                                      | `data-empty`                                                                                                          |
| `Media.UploadItem`     | `li`                                           | `entry` (required), `render`, li props                                                                                | `data-status`                                                                                                         |
| `Media.UploadProgress` | `div[role="progressbar"]`                      | `render`, div props                                                                                                   | `data-status`; `aria-valuenow`, `aria-valuetext`, `aria-label` (file name or `All uploads`)                           |
| `Media.UploadAbort`    | `button`                                       | `render`, button props                                                                                                | `disabled` while nothing is in flight                                                                                 |
| `Media.UploadClear`    | `button`                                       | `render`, button props                                                                                                | none                                                                                                                  |

Keyboard in a listbox grid: ArrowRight/ArrowDown and ArrowLeft/ArrowUp move
focus to the next and previous option, Home/End to the first and last;
Enter and Space select (single mode replaces, multiple mode toggles).

`Media.Dropzone` checks `accept` (`.ext`, `type/*`, exact), `maxSize` and
`maxFiles` before calling `upload()`; rejected files reach `onRejected` with
`'type'`, `'size'` or `'count'`. `onUploaded` receives the `result`s of the
entries that one call resolved with, never the shared ledger. The button
stays focusable while uploading (`aria-disabled`, not `disabled`) and
ignores drops.

`Media.Thumbnail` defaults to `asset.url`, the direct object URL. Public
pages pass `assetUrl={(asset) => assetUrl(asset.id)}` from
`@createcms/react/editor/cms`.

## Hooks

| Hook                        | Returns                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| `useMediaLibrary()`         | The whole `MediaLibraryState` merged with the store actions except `dispose`   |
| `useMediaSelection()`       | `{ selected, select, toggle, clear, mode }`                                    |
| `useMediaUploads()`         | The `MediaUploadState` of the client (`client.useUploadAssets()`)              |
| `useMediaAsset(id)`         | The listed asset or `null`                                                     |
| `useMediaContext(name)`     | `{ store, selection, assetUrl }`; throws outside `Media.Root`                  |
| `useMediaItemContext(name)` | `{ asset, selected }` of the enclosing `Media.Item`                            |
| `useSelector(store, fn)`    | Generic subscription with shallow-equal memo for any `{ subscribe, getState }` |

The store (`createMediaStore`) is framework-free and usable without React;
`pageSize` is clamped to 1–100. List requests carry a ticket: a response
whose ticket is no longer current is dropped. A failed `load()` clears
`nextCursor`, and `setSearch` and `setSort` clear it before reloading, so
`loadMore()` never appends a page of a different query. Bulk mutations (`archive`, `move`, `setStatus`, `createFolder`)
set `mutation.status`, call the client, store the server's `skipped` ids,
then `refresh()`; a rejection sets `mutation.status: 'error'` and rethrows
without touching the list `status`. `Media.Root` also calls `refresh()` when
`isUploading` falls back to `false`.

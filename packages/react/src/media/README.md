# Media (`@createcms/react/media`)

Headless media library over a createcms client: folders, a virtualized APG
grid, selection with bulk actions, filters, intake (drop, paste, folders,
camera), uploads, archive downloads, preview, the detail form with focal
point and versions, per-use image fields and crops, and a constrained
picker. Parts render unstyled elements with `data-*` state and take a
`render` prop; the styled versions are the `media-library`, `media-picker`
and `media-detail` registry items.

The framework-free kernel (store, layout, selection, filter, intake, ZIP
writer, picker rules, image math) is `@createcms/react/media/core`; it has
no React and no runtime dependency.

## Usage

```tsx
import {
  Intake,
  Media,
  Preview,
  Selection,
  Upload,
  usePreview,
} from '@createcms/react/media';

import { cmsClient } from './cms-client';

function Library() {
  const preview = usePreview();
  return (
    <>
      <Media.Search />
      <Intake.Dropzone>
        <Intake.Input />
      </Intake.Dropzone>
      <Media.Grid
        minCell={160}
        gap={12}
        onAction={(asset) => preview.open(asset.id)}
      >
        {(asset) => (
          <Media.Item key={asset.id} asset={asset}>
            <Selection.Checkbox />
            <Media.Thumbnail />
            {asset.originalName ?? asset.slug}
          </Media.Item>
        )}
      </Media.Grid>
      <Media.LoadMore />
      <Upload.List>
        {(entry) => (
          <Upload.Item key={entry.id} entry={entry}>
            {entry.name}
            <Upload.Progress />
            <Upload.Retry />
            <Upload.Cancel />
          </Upload.Item>
        )}
      </Upload.List>
      <Preview.Root>
        <Preview.Stage />
        <Preview.Close />
      </Preview.Root>
    </>
  );
}

export function MediaPage() {
  return (
    <Media.Root client={cmsClient.media} selection="multiple">
      <Library />
    </Media.Root>
  );
}
```

Every visible string comes from the `MediaMessages` catalog (`messages`
and `locale` on `Media.Root`).

## Reference

- Parts, hooks and the catalog: https://createcms.dev/docs/reference/react-media
- The core subpath: https://createcms.dev/docs/reference/react-media-core
- Concepts (asset model, delivery, security): https://createcms.dev/docs/concepts/media
- Tests and the release checklist: https://createcms.dev/docs/resources/media-testing

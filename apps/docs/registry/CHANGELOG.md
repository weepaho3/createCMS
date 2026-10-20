# Registry changelog

Changes to the shadcn registry items under `https://createcms.dev/r/`,
newest first. Items version in lockstep with `@createcms/react`: every
copied file starts with `// @registry <item>@<version>` (CSS:
`/* @registry <item>@<version> */`) and every item pins
`@createcms/react@^<version>`. Breaking entries are repeated in
[BREAKING-CHANGES.md](../../../BREAKING-CHANGES.md#registry-items).

To see what an update changes in your copy, reinstall the item over it and
review the diff:

```bash
npx shadcn@latest add @createcms/editor-shell --overwrite
git diff
```

The diff of an item between two releases is the diff of its source file
between the two `@createcms/react` tags, for example
`git diff @createcms/react@0.3.2 @createcms/react@0.4.0 -- apps/docs/registry/editor-shell.tsx`.

## Unreleased

- **Breaking:** `editor-app` is generic over a `PersistenceAdapter`
  (`EditorApp`, `EditorAppView`); the createCMS page is
  `editor-app-createcms` (`CmsEditor`).
- **Breaking:** `editor-form` is split into `editor-field` (`Field` parts,
  `fieldControls`), `editor-form` (`Form`, `FormSurface`) and
  `editor-form-createcms` (`cmsFields`, `CmsSourcesProvider`).
- **Breaking:** `editor-shell` is split into `editor-chrome`,
  `editor-toolbar`, `editor-palette`, `editor-outline`, `editor-inspector`
  and the shell itself.
- `editor-shell`: phone layout (bottom bar, bottom sheets for properties,
  add block and outline), tablet inspector drawer, named plugin outlets,
  command palette (Mod+K), quick insert (`/`).
- `editor-outline`: virtualized with `@tanstack/react-virtual`.
- `editor-canvas`: accent-based theme tokens, 44px touch targets, a More
  menu (move to, wrap, copy, select parent) in the block toolbar.
- **Breaking:** item files install into `components/` (file type
  `registry:component`) instead of `components/ui/`, so the relative imports
  between items resolve. Move copied files out of `components/ui/`.
- Dependencies between items are full URLs
  (`https://createcms.dev/r/<item>.json`); bare names resolved against the
  shadcn registry and failed to install.
- Every item carries the version stamp and pins `@createcms/react`.
- `editor-canvas`: the drag preview shows the block label above a muted
  excerpt and the selection count as a badge.
- `editor-toolbar`: command palette shortcuts use `CommandShortcut`, so
  the highlighted row keeps enough contrast (WCAG 1.4.3).
- `editor-outline`: the drop indicator is styled (line between rows, box
  for nesting) and the dragged row dims.
- `editor-canvas`: one 2px selection ring without the type chip over the
  content; the block toolbar shows the block label instead. The field ring
  is a quiet dashed outline. Inline rich text keeps the field's layout
  when editing starts (`.prose` first/last child margins).
- `editor-app`: the block toolbar, drop indicator and drag preview draw on
  the host layer, so the frame edge no longer cuts them off; the frame
  fills the visible surface (`frame.minHeight`), so the space below the
  last block takes drops.
- `editor-app` exports `DeviceCanvas` (the device-sized frame canvas that
  fills the visible surface) for custom canvas pages. The outline focus ring
  is inset, so the list edges no longer cut it off.
- `editor-shell` and `editor-form`: form mode keeps the palette and the
  outline (on phones the bottom bar with add block and outline), and the
  form surface shows the path to the selected block and its nested blocks
  per slot, so every block is reachable without a canvas.
- **Breaking:** `editor-outline` renders the flat tree outline
  (`useOutlineRows`, `Editor.Outline` with `rows`, `range` and `reveal`,
  `Editor.OutlineItem row`): slot rows, a drop line at the target level,
  the receiving row marked, refused targets shown as blocked, and a toggle
  that does not select.
- `tree` and `editor-outline`: the tree (or the outline's scroll area)
  keeps an inner padding, so the drop line above the first row, its start
  dot and the rings of rows at the edge stay inside a scrolling parent
  that clips; the tree's drop line starts where the rows do.

# @createcms/react

Headless, unstyled editor and media library primitives for createcms — modeled on
[shadcn's `@shadcn/react`](https://github.com/shadcn-ui/ui): namespace
exports (`Editor.Root`, `Canvas.Root`), a `render` prop instead of `asChild`,
state surfaced as `data-*` attributes, and zero runtime dependencies (only
`react` as a peer, `react-dom` as an optional peer for the canvas subpath).

Styled wrappers built on top of these primitives live in the shadcn-style
component registry, not in this package.

## Entry points

| Entry                              | Holds                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `@createcms/react/editor`          | Parts, hooks, form and preview layer (`Editor.Root`, `useEditorContext`).                                                                   |
| `@createcms/react/editor/core`     | React-free kernel: store, ops, serde, schema helpers, validation; no directive, no runtime dependency.                                      |
| `@createcms/react/editor/canvas`   | Live surface, overlay and interaction layer (`Canvas.Root`, `Canvas.Overlay`).                                                              |
| `@createcms/react/editor/cms`      | Optional createcms client adapters (`useCmsDocument`: load/save, head tracking, canvas resolve; `useCmsFieldSources`: registry field data). |
| `@createcms/react/editor/render`   | `renderDocument` and `RichTextStatic` for published pages; imports only `react`, no directive, runs in Server Components.                   |
| `@createcms/react/editor/richtext` | The Tiptap rich text adapter (`createTiptapAdapter`); the only entry that imports Tiptap.                                                   |
| `@createcms/react/editor/collab`   | Collaborative editing over Yjs (`createYjsDocStore`); the only entry that imports Yjs.                                                      |
| `@createcms/react/media`           | Headless media library (`Media.Root`, `Media.Grid`, `Media.Dropzone`, `Media.UploadList`): folders, paging, search, selection, uploads.     |

`Canvas.Root` renders the store tree through a `components` map.
`Canvas.Overlay` positions rings from measured anchors and hosts an
unstyled block toolbar, insert button, drag handle, palette item, drop
indicator, drag preview and inline text glass for string fields.

See each entry's own README (`src/editor/README.md`,
`src/editor/canvas/README.md`, `src/editor/cms/README.md`,
`src/media/README.md`) for its parts, hooks, types and data attributes.

## Peers

- `react >= 19` (required)
- `react-dom >= 19` (optional: only needed by `/editor/canvas`, for portals)
- `@tiptap/*` `~3.32.0` (optional: only needed by `/editor/richtext`)
- `yjs` `13.6.33` and `y-protocols` `^1.0.7` (optional: only needed by
  `/editor/collab`)

## Status

Published on npm as `@createcms/react`, pre-1.0: the API is not stable yet
and every breaking change ships as a **minor** release (see the repository's
CONTRIBUTING for the versioning rule). Its one runtime dependency is
`fractional-indexing`, imported only by `/editor/collab`; the shared
block/collection/tree types are inlined into its `.d.ts` at build time.
`react` 19 or later is a peer, the others listed above are optional peers.

## Tests

- Node / happy-dom: `bun run test` (from this package; `--maxWorkers=2`).
  Schema, store, form, structure. No layout.
- Chromium, Firefox and WebKit: `bun run test:browser`
  (`src/**/*.browser.test.tsx`, Playwright). Measurement, pointer
  coordinates, iframe `load`, `contentEditable`.
- Property-based (fast-check): `src/editor/core/store/properties.test.ts`,
  ops, inverses, history, serde and remap over random documents.
- Real devices, touch, IME and screen readers: the manual
  [device runbook](./DEVICE-RUNBOOK.md), with a results table per run.
- Never run the `@createcms/core` vitest suite unbounded.

## Bundle size

CI bundles every entry on its own (min+gzip, `react` and `react-dom`
external) and checks it against `bundle-budgets.json`: above the budget
fails, more than 5% above the baseline warns. `/editor/richtext` counts
Tiptap.

| Entry              | Budget (gzip) |
| ------------------ | ------------- |
| `/editor/core`     | 34 KB         |
| `/editor`          | 47 KB         |
| `/editor/canvas`   | 44 KB         |
| `/editor/render`   | 2 KB          |
| `/editor/cms`      | 52 KB         |
| `/editor/richtext` | 152 KB        |
| `/editor/collab`   | 33 KB         |
| `/media`           | 7.5 KB        |

Run `bun scripts/check-bundle-size.mjs` after `bun run build`. The CI also
renders `/editor/render` under the `react-server` condition
(`scripts/check-rsc.mjs`) and checks that no editor entry imports Base UI,
Radix or Floating UI (`scripts/check-subpaths.mjs`).

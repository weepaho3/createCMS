# @createcms/react

Headless, unstyled editor primitives for createcms — modeled on
[shadcn's `@shadcn/react`](https://github.com/shadcn-ui/ui): namespace
exports (`Editor.Root`, `Canvas.Root`), a `render` prop instead of `asChild`,
state surfaced as `data-*` attributes, and zero runtime dependencies (only
`react` as a peer, `react-dom` as an optional peer for the canvas subpath).

Styled wrappers built on top of these primitives live in the shadcn-style
component registry, not in this package.

## Entry points

| Entry                            | Holds                                                                      |
| -------------------------------- | -------------------------------------------------------------------------- |
| `@createcms/react/editor`        | Schema, state, form and preview layer (`Editor.Root`, `useEditorContext`). |
| `@createcms/react/editor/canvas` | Live surface, overlay and interaction layer (`Canvas.Root`).               |
| `@createcms/react/editor/cms`    | Optional adapter to a createcms client. Reserved, empty for now.           |

See each entry's own README (`src/editor/README.md`,
`src/editor/canvas/README.md`, `src/editor/cms/README.md`) for its parts,
hooks, types and data attributes.

## Peers

- `react >= 19` (required)
- `react-dom >= 19` (optional — only needed by `/editor/canvas`, for portals)

## Status

Published on npm as `@createcms/react`, pre-1.0: the API is not stable yet
and every breaking change ships as a **minor** release (see the repository's
CONTRIBUTING for the versioning rule). It has no runtime dependency — the
shared block/collection/tree types are inlined into its `.d.ts` at build
time; `react` ≥ 19 is a peer, `react-dom` ≥ 19 an optional peer for the
canvas entry.

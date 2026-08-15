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

Private and unpublished for now: it depends on the also-unpublished
`@createcms/schema` package. Both flip to public with a semver range once the
release wiring lands. No store, hooks with behavior, field or canvas parts
exist yet — this package is currently a skeleton (context, namespace
placeholders, the local `useRender` helper).

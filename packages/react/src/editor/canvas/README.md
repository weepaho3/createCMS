# Canvas (`@createcms/react/editor/canvas`)

Headless editor primitive: live surface, overlay and interaction layer.
Unstyled; styling happens in the consumer's wrapper components (registry).

## Usage

`Canvas.Root` renders the store tree through a `components` map. Pass a plain
`{ heading: Heading }` record or a `{ _components }` object (the shape
`createBlocksMap` returns). `components` is required. Consumer `children` are
the overlay slot, rendered after the tree inside the host.

```tsx
import { Editor } from '@createcms/react/editor';
import { Canvas } from '@createcms/react/editor/canvas';

function PageCanvas({ schema, tree, pageBlocks }) {
  return (
    <Editor.Root schema={schema} defaultValue={tree}>
      <Canvas.Root components={pageBlocks} />
    </Editor.Root>
  );
}
```

Spread `edit.block` on each block's root element and `edit.field.<key>` on
the element that shows that property. Leftover missing anchors are a dev
warning because measurement cannot see a block without `data-editor-block`.
A `display: contents` wrapper is the documented escape when the component
has no single root.

`resolve` and `components` must be referentially stable: an inline object
literal re-runs every resolver. `surface="frame"` throws
(`Canvas.Root: surface "frame" is not implemented`).

## Parts

| Part          | Default element | Props                                                                                                   | Data attributes                                                           |
| ------------- | --------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `Canvas.Root` | `div`           | `components` (required), `surface`, `interactive`, `resolve`, `children` (overlay), `render`, div props | `data-editor-canvas`, `data-interactive`, `data-dragging`, `data-editing` |

## Hooks

| Hook          | Returns          | Notes                                                                                         |
| ------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| `useResolved` | `T \| undefined` | Reads the canvas resolve cache. Throws outside `Canvas.Root`. `undefined` is miss or pending. |

## Types

| Type                | Description                                                                    |
| ------------------- | ------------------------------------------------------------------------------ |
| `CanvasRootProps`   | Props of `Canvas.Root`.                                                        |
| `CanvasComponents`  | A plain block map, or `{ _components }` as `createBlocksMap` returns.          |
| `CanvasResolve`     | Optional `reference` / `link` / `string` resolvers. `image` is never resolved. |
| `CanvasInteractive` | `'edit' \| 'select' \| 'none'`. Default `'edit'`.                              |
| `CanvasSurface`     | `'inline' \| 'frame'`. Default `'inline'`. `'frame'` throws.                   |

## Data attributes

| Attribute              | Where                                | Meaning                                                                            |
| ---------------------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| `data-editor-canvas`   | host                                 | Presence marker.                                                                   |
| `data-interactive`     | host                                 | `'edit'`, `'select'`, or `'none'`.                                                 |
| `data-dragging`        | host                                 | Present while dragging. Absent in this surface (no drag).                          |
| `data-editing`         | host                                 | Present while the local selection has an inline-editing target.                    |
| `data-editor-block`    | block root via `edit.block`          | Document-tree block id.                                                            |
| `data-editor-field`    | field element via `edit.field.<key>` | Property key, counted only inside its own block.                                   |
| `data-unresolved`      | block root via `edit.block`          | Present when a routed `reference` / `link` / `string` value is pending or missing. |
| `data-editor-readonly` | wrapper around referenced children   | Together with `inert`, excludes the subtree from click-select.                     |

## Tests

happy-dom (`editor.test.tsx`, `renderer.test.tsx`) covers context sharing,
the throw outside `Editor.Root`, the store-tree walk, resolve cache,
referenced readonly trees and click intercept. Chromium
(`canvas.browser.test.tsx`) covers layout, pointer coordinates, click
select/focus, `interactive="select"` (no drag) and `interactive="none"`.
Unit tests never assert rects. Browser tests never screenshot; they assert
rects and DOM. Helpers: `test/harness.tsx`, `test/fixtures.tsx` and
`test/hero-fixtures.tsx` (not test files).

| File                      | Covers                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `editor.test.tsx`         | Canvas.Root shares context with Editor.Root; throws outside it.                                                           |
| `renderer.test.tsx`       | Root fragment, edit anchors, unknown type, resolve cache, unresolved omit, referenced readonly, intercept, Hero snapshot. |
| `canvas.browser.test.tsx` | Chromium: host box, heading anchor rect, layout wait, pointer coordinates, click select/focus, select mode, none mode.    |

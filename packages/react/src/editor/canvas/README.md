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
      <Canvas.Root components={pageBlocks} style={{ position: 'relative' }}>
        <Canvas.Overlay>
          <Canvas.SelectionRing />
          <Canvas.HoverRing />
          <Canvas.FieldRing />
        </Canvas.Overlay>
      </Canvas.Root>
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

The canvas host needs a positioning context (`position: relative` or
similar) so `Canvas.Overlay`'s `absolute; inset: 0` covers the surface.
The primitive does not set `position` on the host. Overlay is
`pointer-events: none`. A child that must receive pointer input sets
`pointer-events: auto` on itself.

## Parts

| Part                   | Default element | Props                                                                                                   | Data attributes                                                                                        |
| ---------------------- | --------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Canvas.Root`          | `div`           | `components` (required), `surface`, `interactive`, `resolve`, `children` (overlay), `render`, div props | `data-editor-canvas`, `data-interactive`, `data-dragging`, `data-editing`                              |
| `Canvas.Overlay`       | `div`           | `render`, div props. Portals into the canvas host.                                                      | `data-editor-overlay`                                                                                  |
| `Canvas.SelectionRing` | `div`           | `render`, div props. Sized from the selected block rect.                                                | `data-editor-selection-ring`, `data-block-type`, `data-can-move`, `data-can-delete`, `data-unresolved` |
| `Canvas.HoverRing`     | `div`           | `render`, div props. Hidden while dragging, editing, or when hovered equals selected.                   | `data-editor-hover-ring`, `data-block-type`, `data-can-move`, `data-can-delete`, `data-unresolved`     |
| `Canvas.FieldRing`     | `div`           | `render`, div props. Sized from the focused field rect (own-block only).                                | `data-editor-field-ring`, `data-block-type`, `data-can-move`, `data-can-delete`, `data-unresolved`     |

## Hooks

| Hook           | Returns              | Notes                                                                                         |
| -------------- | -------------------- | --------------------------------------------------------------------------------------------- |
| `useResolved`  | `T \| undefined`     | Reads the canvas resolve cache. Throws outside `Canvas.Root`. `undefined` is miss or pending. |
| `useBlockRect` | `CanvasRect \| null` | Content coordinates of a block id (union of same-id nodes). Throws outside `Canvas.Root`.     |
| `useFieldRect` | `CanvasRect \| null` | Content coordinates of a field on its own block. Throws outside `Canvas.Root`.                |

## Types

| Type                       | Description                                                                    |
| -------------------------- | ------------------------------------------------------------------------------ |
| `CanvasRootProps`          | Props of `Canvas.Root`.                                                        |
| `CanvasOverlayProps`       | Props of `Canvas.Overlay`.                                                     |
| `CanvasSelectionRingProps` | Props of `Canvas.SelectionRing`.                                               |
| `CanvasHoverRingProps`     | Props of `Canvas.HoverRing`.                                                   |
| `CanvasFieldRingProps`     | Props of `Canvas.FieldRing`.                                                   |
| `CanvasRingState`          | `blockType`, `canMove`, `canDelete`, `unresolved` on every ring.               |
| `CanvasRect`               | `{ x, y, width, height }` in canvas content coordinates.                       |
| `CanvasComponents`         | A plain block map, or `{ _components }` as `createBlocksMap` returns.          |
| `CanvasResolve`            | Optional `reference` / `link` / `string` resolvers. `image` is never resolved. |
| `CanvasInteractive`        | `'edit' \| 'select' \| 'none'`. Default `'edit'`.                              |
| `CanvasSurface`            | `'inline' \| 'frame'`. Default `'inline'`. `'frame'` throws.                   |

## Data attributes

| Attribute                    | Where                                | Meaning                                                                                                                                                 |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-editor-canvas`         | host                                 | Presence marker.                                                                                                                                        |
| `data-interactive`           | host                                 | `'edit'`, `'select'`, or `'none'`.                                                                                                                      |
| `data-dragging`              | host                                 | Present while dragging. Absent in this surface (no drag).                                                                                               |
| `data-editing`               | host                                 | Present while the local selection has an inline-editing target.                                                                                         |
| `data-editor-block`          | block root via `edit.block`          | Document-tree block id.                                                                                                                                 |
| `data-editor-field`          | field element via `edit.field.<key>` | Property key, counted only inside its own block.                                                                                                        |
| `data-unresolved`            | block root via `edit.block`; rings   | Present when a routed `reference` / `link` / `string` value is pending or missing. On a ring: any measured block element for that id has the attribute. |
| `data-editor-readonly`       | wrapper around referenced children   | Together with `inert`, excludes the subtree from click-select and measurement.                                                                          |
| `data-editor-overlay`        | Overlay host                         | Presence marker. `pointer-events: none`; `aria-hidden`.                                                                                                 |
| `data-editor-selection-ring` | `Canvas.SelectionRing`               | Presence marker.                                                                                                                                        |
| `data-editor-hover-ring`     | `Canvas.HoverRing`                   | Presence marker.                                                                                                                                        |
| `data-editor-field-ring`     | `Canvas.FieldRing`                   | Presence marker.                                                                                                                                        |
| `data-block-type`            | rings                                | Store node type. Omitted when the id is unknown.                                                                                                        |
| `data-can-move`              | rings                                | Present when the block is not the root.                                                                                                                 |
| `data-can-delete`            | rings                                | Present when the block is not the root.                                                                                                                 |

## Tests

happy-dom (`editor.test.tsx`, `renderer.test.tsx`, `rect.test.ts`,
`overlay.test.tsx`) covers context sharing, the throw outside
`Editor.Root` / `Canvas.Root`, the store-tree walk, resolve cache,
referenced readonly trees, click intercept, rect unions, readonly skip,
nested field keys, Overlay portal, and ring presence / hover
suppression. Chromium (`canvas.browser.test.tsx`) covers layout, pointer
coordinates, click select/focus, `interactive="select"` (no drag),
`interactive="none"`, ring vs block `getBoundingClientRect` (1 px),
resize, scroll without remeasure, nested field key, and same-id union.
Unit tests never assert rects. Browser tests never screenshot; they assert
rects and DOM. Helpers: `test/harness.tsx`, `test/fixtures.tsx` and
`test/hero-fixtures.tsx` (not test files).

| File                      | Covers                                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `editor.test.tsx`         | Canvas.Root shares context with Editor.Root; throws outside it. Overlay throw; Canvas namespace keys.                                                                                                  |
| `renderer.test.tsx`       | Root fragment, edit anchors, unknown type, resolve cache, unresolved omit, referenced readonly, intercept, Hero snapshot.                                                                              |
| `rect.test.ts`            | `unionRects`, readonly skip, nested field key own-block lookup.                                                                                                                                        |
| `overlay.test.tsx`        | Overlay portal into host, `useBlockRect` callable, SelectionRing / FieldRing presence, HoverRing suppression.                                                                                          |
| `canvas.browser.test.tsx` | Chromium: host box, heading anchor rect, layout wait, pointer coordinates, click select/focus, select mode, none mode, ring alignment after layout / resize / scroll, nested field key, same-id union. |

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
          <Canvas.BlockToolbar side="top" align="start">
            {/* consumer buttons via useBlockActions(selectedId) */}
          </Canvas.BlockToolbar>
          <Canvas.InsertButton placement="between" type="paragraph" />
          <Canvas.DragHandle blockId="selectedBlockId" />
          <Canvas.PaletteItem type="paragraph" />
          <Canvas.DropIndicator />
          <Canvas.DragPreview />
          <Canvas.InlineText />
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
`pointer-events: none` and is not `aria-hidden`. Rings set
`aria-hidden`. A child that must receive pointer input sets
`pointer-events: auto` on itself.

`Canvas.Provider` (optional) owns the drag session; each `Canvas.Root`
below it registers itself as a surface. `Canvas.PaletteItem` and
`Canvas.DragHandle` then work anywhere under the provider, for example a
shell sidebar outside the canvas host; the surface under the pointer
resolves the drop against its own host, and only the hovered canvas
auto-scrolls. `Canvas.DragPreview` follows the pointer with `translate3d` on
the DOM node (no React re-render per move) and renders only inside a
`Canvas.Root`. Without a provider, `Canvas.Root`
creates the session itself and provides it to its children.

```tsx
<Editor.Root schema={schema} defaultValue={tree}>
  <Canvas.Provider>
    <aside>
      <Canvas.PaletteItem type="paragraph" />
    </aside>
    <Canvas.Root components={pageBlocks} style={{ position: 'relative' }}>
      <Canvas.Overlay>
        <Canvas.DropIndicator />
        <Canvas.DragPreview />
      </Canvas.Overlay>
    </Canvas.Root>
  </Canvas.Provider>
</Editor.Root>
```

## Parts

| Part                   | Default element | Props                                                                                                                                                                                                         | Data attributes                                                                                           |
| ---------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `Canvas.Provider`      | none            | `children`. Renders no element; owns the drag session shared by every part and `Canvas.Root` below it. Optional.                                                                                              | none                                                                                                      |
| `Canvas.Root`          | `div`           | `components` (required), `surface`, `interactive`, `resolve`, `children` (overlay), `render`, div props                                                                                                       | `data-editor-canvas`, `data-interactive`, `data-dragging`, `data-editing`                                 |
| `Canvas.Overlay`       | `div`           | `render`, div props. Portals into the canvas host.                                                                                                                                                            | `data-editor-overlay`                                                                                     |
| `Canvas.SelectionRing` | `div`           | `render`, div props. Sized from the selected block rect.                                                                                                                                                      | `data-editor-selection-ring`, `data-block-type`, `data-can-move`, `data-can-delete`, `data-unresolved`    |
| `Canvas.HoverRing`     | `div`           | `render`, div props. Hidden while dragging, editing, or when hovered equals selected.                                                                                                                         | `data-editor-hover-ring`, `data-block-type`, `data-can-move`, `data-can-delete`, `data-unresolved`        |
| `Canvas.FieldRing`     | `div`           | `render`, div props. Sized from the focused field rect (own-block only).                                                                                                                                      | `data-editor-field-ring`, `data-block-type`, `data-can-move`, `data-can-delete`, `data-unresolved`        |
| `Canvas.BlockToolbar`  | `div`           | `align`, `side`, `offset`, `render`, div props. Consumer supplies buttons. Shown in `edit` and `select`.                                                                                                      | `data-editor-block-toolbar`, `data-side`, `data-block-type`                                               |
| `Canvas.InsertButton`  | `button`        | `placement` (`between` \| `container`), optional `type`, optional `onInsert`, `render`, button props. Shown only in `edit`.                                                                                   | `data-editor-insert-button`, `data-orientation`, `data-empty-container`                                   |
| `Canvas.DragHandle`    | `button`        | `blockId` (required), `render`, button props. Move an existing block by pointer drag. Shown only in `edit`. Overlay siblings anchor to the block rect; inside `Canvas.BlockToolbar` the handle stays in flow. | `data-editor-drag-handle`, `data-dragging` on the handle while its block is the move session              |
| `Canvas.PaletteItem`   | `button`        | `type` (required), optional `properties`, `render`, button props. Click inserts like `Editor.AddBlock` when the current selection can host the type; drag is always available.                                | `data-editor-palette-item`, `data-block-type`, `data-dragging` while this item starts a new-block session |
| `Canvas.DropIndicator` | `div`           | `render`, div props. Line or box from the active drop target. Presentational.                                                                                                                                 | `data-editor-drop-indicator`, `data-orientation`, `data-variant`, `data-kind` (`new` \| `move`)           |
| `Canvas.DragPreview`   | `div`           | `render`, div props, optional children. Follows the pointer during a session. Presentational.                                                                                                                 | `data-editor-drag-preview`, `data-kind` (`new` \| `move`)                                                 |
| `Canvas.InlineText`    | `div`           | `suggest`, `discardOnEscape`, `render`, div props. Overlays a contentEditable glass on string and richText fields in `edit`.                                                                                  | `data-editor-inline-text`, `data-editing`, `data-block-type`, `data-field`                                |

## Hooks

| Hook              | Returns                | Notes                                                                                                                                                        |
| ----------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useResolved`     | `T \| undefined`       | Reads the canvas resolve cache. Throws outside `Canvas.Root`. `undefined` is miss or pending.                                                                |
| `useBlockRect`    | `CanvasRect \| null`   | Content coordinates of a block id (union of same-id nodes). Throws outside `Canvas.Root`.                                                                    |
| `useFieldRect`    | `CanvasRect \| null`   | Content coordinates of a field on its own block. Throws outside `Canvas.Root`.                                                                               |
| `useInsertTarget` | `InsertTarget \| null` | Resolved line or box from pointer and hover. Throws outside `Canvas.Root`. Null in `select` / `none`, while dragging or editing, or without pointer / hover. |

## Types

| Type                         | Description                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `CanvasProviderProps`        | Props of `Canvas.Provider`.                                                                       |
| `CanvasRootProps`            | Props of `Canvas.Root`.                                                                           |
| `CanvasOverlayProps`         | Props of `Canvas.Overlay`.                                                                        |
| `CanvasSelectionRingProps`   | Props of `Canvas.SelectionRing`.                                                                  |
| `CanvasHoverRingProps`       | Props of `Canvas.HoverRing`.                                                                      |
| `CanvasFieldRingProps`       | Props of `Canvas.FieldRing`.                                                                      |
| `CanvasRingState`            | `blockType`, `canMove`, `canDelete`, `unresolved` on every ring.                                  |
| `CanvasRect`                 | `{ x, y, width, height }` in canvas content coordinates.                                          |
| `CanvasComponents`           | A plain block map, or `{ _components }` as `createBlocksMap` returns.                             |
| `CanvasResolve`              | Optional `reference` / `link` / `string` resolvers. `image` is never resolved.                    |
| `CanvasInteractive`          | `'edit' \| 'select' \| 'none'`. Default `'edit'`.                                                 |
| `CanvasSurface`              | `'inline' \| 'frame'`. Default `'inline'`. `'frame'` throws.                                      |
| `InsertTarget`               | Resolved insert: `parentId`, `index`, `orientation`, `variant`, `rect`, `allowedTypes`, `nested`. |
| `InsertOrientation`          | `'horizontal'` \| `'vertical'`.                                                                   |
| `InsertVariant`              | `'line'` \| `'box'`.                                                                              |
| `ResolveInsertAtOptions`     | Injected rects and row-flow stub for `resolveInsertAt`.                                           |
| `CanvasBlockToolbarProps`    | Props of `Canvas.BlockToolbar`.                                                                   |
| `CanvasInsertButtonProps`    | Props of `Canvas.InsertButton`.                                                                   |
| `PointerStore`               | External pointer snapshot store on the canvas context.                                            |
| `CanvasInlineTextProps`      | Props of `Canvas.InlineText`.                                                                     |
| `InlineSuggest`              | Optional `$`-anchored suggest config: `pattern`, `getItems`, `render`.                            |
| `InlineSuggestItem`          | Suggest row: `insertText` plus consumer fields for `render`.                                      |
| `InlineSuggestRenderContext` | Suggest UI context: items, highlight, query, anchor rect, `accept`.                               |

## Data attributes

| Attribute                    | Where                                | Meaning                                                                                                                                                 |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data-editor-canvas`         | host                                 | Presence marker.                                                                                                                                        |
| `data-interactive`           | host                                 | `'edit'`, `'select'`, or `'none'`.                                                                                                                      |
| `data-dragging`              | host, drag handle, palette item      | Present on the host while any canvas drag session is active; on a handle or palette item while that part owns the session.                              |
| `data-editing`               | host, inline glass                   | Present while the local selection has an inline-editing target.                                                                                         |
| `data-editor-block`          | block root via `edit.block`          | Document-tree block id.                                                                                                                                 |
| `data-editor-field`          | field element via `edit.field.<key>` | Property key, counted only inside its own block.                                                                                                        |
| `data-unresolved`            | block root via `edit.block`; rings   | Present when a routed `reference` / `link` / `string` value is pending or missing. On a ring: any measured block element for that id has the attribute. |
| `data-editor-readonly`       | wrapper around referenced children   | Together with `inert`, excludes the subtree from click-select and measurement.                                                                          |
| `data-editor-overlay`        | Overlay host                         | Presence marker. `pointer-events: none`; not `aria-hidden`.                                                                                             |
| `data-editor-block-toolbar`  | `Canvas.BlockToolbar` inner chrome   | Presence marker. `role="toolbar"`.                                                                                                                      |
| `data-editor-insert-button`  | `Canvas.InsertButton`                | Presence marker.                                                                                                                                        |
| `data-side`                  | `Canvas.BlockToolbar`                | `'top'` or `'bottom'`.                                                                                                                                  |
| `data-orientation`           | `Canvas.InsertButton`                | `'horizontal'` or `'vertical'`.                                                                                                                         |
| `data-empty-container`       | `Canvas.InsertButton`                | Present when the target variant is `box`.                                                                                                               |
| `data-editor-drag-handle`    | `Canvas.DragHandle`                  | Presence marker.                                                                                                                                        |
| `data-editor-palette-item`   | `Canvas.PaletteItem`                 | Presence marker.                                                                                                                                        |
| `data-editor-drop-indicator` | `Canvas.DropIndicator`               | Presence marker. `aria-hidden`.                                                                                                                         |
| `data-editor-drag-preview`   | `Canvas.DragPreview`                 | Presence marker. `aria-hidden`.                                                                                                                         |
| `data-kind`                  | drop indicator, drag preview         | `'new'` or `'move'`.                                                                                                                                    |
| `data-variant`               | `Canvas.DropIndicator`               | `'line'` or `'box'`.                                                                                                                                    |
| `data-editor-selection-ring` | `Canvas.SelectionRing`               | Presence marker.                                                                                                                                        |
| `data-editor-hover-ring`     | `Canvas.HoverRing`                   | Presence marker.                                                                                                                                        |
| `data-editor-field-ring`     | `Canvas.FieldRing`                   | Presence marker.                                                                                                                                        |
| `data-block-type`            | rings                                | Store node type. Omitted when the id is unknown.                                                                                                        |
| `data-can-move`              | rings                                | Present when the block is not the root.                                                                                                                 |
| `data-can-delete`            | rings                                | Present when the block is not the root.                                                                                                                 |
| `data-editor-inline-text`    | `Canvas.InlineText` glass            | Presence marker. `role="textbox"`.                                                                                                                      |
| `data-field`                 | `Canvas.InlineText` glass            | Property key being edited.                                                                                                                              |

During an inline session the origin field element gets
`visibility: hidden` so `getComputedStyle(origin).color` stays real. Empty
string and richText display properties may carry a zero-width placeholder in
the canvas renderer; neither value is stored.

## Tests

happy-dom (`editor.test.tsx`, `renderer.test.tsx`, `rect.test.ts`,
`overlay.test.tsx`, `insert.test.ts`, `toolbar.test.tsx`, `dnd.test.ts`,
`dnd-parts.test.tsx`, `provider.test.tsx`, `inline-text.test.ts`, `inline-parts.test.tsx`) covers context sharing, the throw outside
`Editor.Root` / `Canvas.Root`, the store-tree walk, resolve cache,
referenced readonly trees, click intercept, rect unions, readonly skip,
nested field keys, Overlay portal, ring presence / hover suppression, pure
insert geometry, toolbar / insert presence, overlay chrome hover, DnD
store helpers, drag-handle threshold, palette click insert, escape cancel
and drop-indicator gating, provider session sharing and the palette outside
the canvas, inline-text helpers, InlineText activation gating,
empty-field placeholder. Chromium (`canvas.browser.test.tsx`,
`insert.browser.test.tsx`, `dnd.browser.test.tsx`, `provider.browser.test.tsx`, `inline-text.browser.test.tsx`) covers layout, pointer
coordinates, click select/focus, `interactive="select"` (no drag), `interactive="none"`, ring
vs block `getBoundingClientRect` (1 px), resize, scroll without remeasure,
nested field key, same-id union, column / row / grid insert lines, empty
container box, toolbar placement, insert disabled gating, select-mode
toolbar without insert, pointer drag move and palette drop, drop
indicator orientation, escape cancel, auto-scroll, touch input, forbidden
placement, focus after drop and select-mode drag suppression, sidebar
palette drag under a provider, per-surface drop resolution across two
canvases, inline-text
activation, caret placement, typing, Enter and Escape, nested and same-element
fields, empty badge, suggest keyboard, two canvases, number field gating, undo
during session.
Unit tests never assert rects. Browser tests never screenshot; they assert
rects and DOM. Helpers: `test/harness.tsx`, `test/fixtures.tsx` and
`test/hero-fixtures.tsx` (not test files).

| File                           | Covers                                                                                                                                                                                                                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor.test.tsx`              | Canvas.Root shares context with Editor.Root; throws outside it. Overlay throw; Canvas namespace keys.                                                                                                                                                                                  |
| `renderer.test.tsx`            | Root fragment, edit anchors, unknown type, resolve cache, unresolved omit, referenced readonly, intercept, Hero snapshot.                                                                                                                                                              |
| `rect.test.ts`                 | `unionRects`, readonly skip, nested field key own-block lookup.                                                                                                                                                                                                                        |
| `overlay.test.tsx`             | Overlay portal into host, `useBlockRect` callable, SelectionRing / FieldRing presence, HoverRing suppression.                                                                                                                                                                          |
| `insert.test.ts`               | Pure `resolveInsertAt`: column, row, grid wrap, empty box, walk-up `canPlace`, `draggedId` exclusion, globally nearest ancestor.                                                                                                                                                       |
| `toolbar.test.tsx`             | BlockToolbar / InsertButton throw outside Root, selection and `interactive="none"` gating, overlay chrome keeps hover.                                                                                                                                                                 |
| `dnd.test.ts`                  | Pure DnD helpers: `adjustMoveIndex`, `blockIdAtPoint`, store threshold, session vs target subscriptions.                                                                                                                                                                               |
| `dnd-parts.test.tsx`           | DragHandle / PaletteItem / DropIndicator / DragPreview throw outside Root; preview uses translate3d during drag; palette click insert; click no-op when placement fails; click after drag; drag threshold; inline-edit does not block the handle; escape cancel; pointerup off handle. |
| `provider.test.tsx`            | Palette outside Root under a Provider renders enabled and click-inserts; palette without Provider and Root throws; plain Root still provides the session.                                                                                                                              |
| `canvas.browser.test.tsx`      | Chromium: host box, heading anchor rect, layout wait, pointer coordinates, click select/focus, select mode, none mode, ring alignment after layout / resize / scroll, nested field key, same-id union.                                                                                 |
| `insert.browser.test.tsx`      | Chromium: column / row / grid insert lines, empty container box, toolbar side / align, insert disabled gating, select mode without insert.                                                                                                                                             |
| `dnd.browser.test.tsx`         | Chromium: palette drop into empty stack, column and row sibling moves, escape cancel, auto-scroll, touch drag, forbidden placement, focus after drop, select mode without drag.                                                                                                        |
| `provider.browser.test.tsx`    | Chromium: sidebar palette drag into the canvas under a Provider; two canvases under one provider resolve drops on the hovered editable surface.                                                                                                                                        |
| `inline-text.test.ts`          | Pure inline helpers: `applyTextEdit`, placeholder injection, field kind.                                                                                                                                                                                                               |
| `inline-parts.test.tsx`        | InlineText throw outside Root; string vs number activation; nested key; same element; two editors; empty badge commit.                                                                                                                                                                 |
| `inline-text.browser.test.tsx` | Chromium: glass activation, caret, typing, Enter/Escape, discardOnEscape, nested key, richText multiline, empty badge, suggest keyboard, two canvases, number field, undo during session.                                                                                              |

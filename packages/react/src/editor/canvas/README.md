# Canvas (`@createcms/react/editor/canvas`)

Headless editor primitive: live surface, overlay and interaction layer.
Unstyled; styling happens in the consumer's wrapper components (registry).

## Usage

`Canvas.Root` renders the store document through a `components` map, one
component per type. Each receives `CanvasComponentProps`: `id`, `type`,
`props` (resolved, see `resolve`, with `resolveData` results on top),
`children` (the rendered `children` slot), `slots` (every slot rendered) and
`edit`. `components` is required. Rendering is per node: a block re-renders
only when its own type or props change, never when other blocks change or
when the order inside its slots changes, and each block sits in its own error
boundary. A block that throws shows `Canvas.BlockError` (or
`renderBlockError`) and reports a `render` error to `Editor.Root`'s
`onError`; new props or an undo render it again. A type without a component
shows `Canvas.UnknownBlock` (or `renderUnknownBlock`), selectable, with its
data kept as stored. `chunkSize` groups the root's blocks into wrappers with
`content-visibility: auto` for long documents (off by default; during a drag
every chunk renders fully). With `interactive="none"` the canvas is a
read-only per-node preview that renders updates deferred. For a
createcms `createBlocksMap` result, pass `cmsCanvasComponents(blocksMap)` from
[`@createcms/react/editor/cms`](/docs/reference/react-editor-cms). Consumer
`children` are the overlay slot, rendered after the tree inside the host.

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

Spread `edit.block` on each block's root element, `edit.field.<key>` on the
element that shows that field and `edit.slot.<name>` on the element that
holds that slot's children (`EditProps` from
[`@createcms/react/editor/core`](/docs/reference/react-editor-core)).
Leftover missing anchors are a dev warning because measurement cannot see a
block without `data-editor-block`.

`resolve` and `components` must be referentially stable: an inline object
literal re-runs every resolver. `surface` defaults to `'inline'`.
`surface="frame"` throws (`Canvas.Root: surface "frame" is not implemented`).

`interactive` is `'edit' | 'select' | 'none'` (default `'edit'`). Optional
`resolve` maps a field kind to a `FieldResolver` `(value, field)` that returns
what the component renders (a referenced document, a link's href, text with
variables filled in), a promise of it, or `undefined`. Results are cached per
kind and value. Kinds without a resolver, and empty values, render as stored.
While a resolution is pending or missing, the stored value is rendered and
the block's anchor carries `data-unresolved`.

Wrap an embedded tree that is shown but never edited (a referenced document,
a preview of a reusable section) in `Canvas.ReadonlySubtree`: it is `inert`
and `display: contents`, and anchors inside it are skipped by measurement,
selection, rings and drop targets.

The canvas host needs a positioning context (`position: relative` or
similar) so `Canvas.Overlay`'s `absolute; inset: 0` covers the surface.
Overlay portals into the host. Overlay is `pointer-events: none` and is not
`aria-hidden`. Rings set `aria-hidden`. A child that must receive pointer
input sets `pointer-events: auto` on itself.

DnD is pointer-based (not HTML5 drag). `Canvas.InlineText` is the GLASS
overlay for `string` fields in `edit`. `richText` fields edit in place
instead, through `Editor.Root richText`: a click selects the block and
mounts the editor on the field element itself, with the caret at the click
point and the formatting kept; the block keeps rendering the value it
started from, so the editor owns that element until the session ends.
Edits write the field live (one undo step per typing run), undo and redo
inside the editor run the store's history, Escape or moving the focus
elsewhere ends the session, a drag ends it, and hovering a field starts
loading a `lazyRichTextAdapter`. Give rich text fields a block element as
their anchor (`div`, `section`): the editor renders paragraphs inside it.
`Canvas.InlineRichTextToolbar` shows the formatting buttons of the running
session (by default every format the field allows; `Editor.RichTextToolbar`
and `Editor.RichTextToolbarButton` as children) and renders nothing
otherwise; inside `Canvas.BlockToolbar` its buttons keep the editor's
focus, also over a frame. Without `Editor.Root richText`, a click on a
`richText` field selects the block and focuses its form control, and a
development build logs `[editor:E001]` once.

Plain-text rules apply to the glass and to `useEditableField`: a `text`
field is single-line, so Enter ends editing and pasted or dropped line
breaks turn into spaces, `maxLength` cuts typed and pasted text, paste and drop insert
plain text only, and nothing commits while an IME composition runs. The
glass takes its `aria-label` from the field label and its
`aria-placeholder` from the field placeholder.

A `text` field's `inline` option picks the editing mode: `'glass'` (the
default) overlays the glass, `'in-place'` leaves the field to
`useEditableField` in the component, and `false` keeps it in the form only.
In-place editing fits text the glass cannot copy (gradients with
`background-clip: text`, balanced wrapping, columns, transforms):

```tsx
function Hero({ id, props, edit }: CanvasComponentProps<'hero'>) {
  const title = useEditableField(id, 'title');
  return (
    <h1 {...edit.field.title} {...title.props}>
      {title.editable ? null : props.title}
    </h1>
  );
}
```

A click selects the deepest block under the pointer. Shift+click selects
the range from the primary selection to the clicked block's ancestor in the
same slot, Mod+click toggles a block in the selection, and Alt+click selects
the parent (one level further up on each repeat); none of them start
editing. `clickToEdit` picks how a click on a text field starts editing:
`select-and-edit` (a mouse by default) selects and edits at once,
`select-first` (touch and pen by default) selects on the first tap and edits
on a tap on the selected block. The host sets `touch-action: manipulation`.
Hover shows at once and clears 100 ms after the pointer leaves a block.

`Canvas.ContextMenu` opens on a right click on a block: the block commands
(`CONTEXT_MENU_COMMANDS` or `commands`), a row per ancestor to select it,
and the block behind the pointer. `Canvas.BlockToolbar` is one tab stop
(`useRovingFocus`): arrows move between its controls, Alt+F10 enters it
from the canvas or inline text without changing the selection, and Escape
returns to where focus was.

## Dragging

A drag starts by pointer type: a mouse on `Canvas.DragHandle` on the first
movement, a mouse elsewhere (`Canvas.PaletteItem`) and a pen after 5 px, a
touch after a still 250 ms press (moving earlier cancels it). Inputs,
links, editable text and other buttons inside a drag source never start a
drag. Dragged blocks carry `data-dragging`.

The block under the pointer comes from the browser's own hit test
(`elementsFromPoint`), so its cost follows the nesting depth, not the
block count; the dragged block, its descendants and read-only subtrees are
skipped. A leaf's outer 6 px and the 30 px band at the edge of a container
taller than 120 px (past its children, along the parent's flow) drop
beside it instead of into it. From that block the nearest gap of every
slot up its ancestors that takes the type wins, and the target holds
against jitter: it changes after 10 px of movement or for a clearly
closer gap. Dragging one block of a multi-selection moves all selected
blocks (the outermost ones), landing next to each other in document order
as one undo step. When someone else removes a dragged block, the drag ends
and `Editor.LiveAnnouncer` says so.

`Canvas.DragHandle` also works without dragging (WCAG 2.5.7). A click or
Enter opens its menu (`role="menu"`: move up, move down, move to, duplicate,
delete; Move to opens `Editor.MoveToDialog`). Space picks the block up for
a keyboard drag: arrows step through every valid place in document order
(`insertionPoints`), the drop indicator follows, Space or Enter drops,
Escape or leaving the handle puts the block back. `Editor.LiveAnnouncer`
announces each step; focus returns to the handle.

Files dragged from the desktop need `fileDrop` (`CanvasFileDrop`:
`blockType`, `field`, `upload(file)`, `accept?`): the drop indicator
follows the same targets, and each dropped file is uploaded and inserted
in order at the drop position. Empty slots keep a minimum height while
editing in the registry styles (`--editor-slot-min-empty-height`, 128 px).

Rings measure what they show. The measurer keeps only tracked rects
current (rings, toolbars, handles: one shared ResizeObserver, a
MutationObserver that ignores the overlay, scroll and font changes, one
animation frame of reads, a 100 ms poll for movement no observer reports)
and measures any other rect on demand. Blocks without a box of their own
(`display: contents`, zero size) take their text or children's box;
selection and hover rings are cut by overflow ancestors and flag the cut
edges (`data-clamped-left`, `-top`, `-right`, `-bottom`); fixed and sticky
blocks keep their ring while the canvas scrolls. Rings carry
`data-state` (`selected`, `hover`), `data-kind` (`block`, `ref`) and the
CSS variables `--x --y --w --h --el-radius` (the block's own corner
radius) for box-shadow rings without transitions on position.
`Canvas.BlockToolbar` carries `data-flipped` when it moved inside the block
and, on the host layer, `data-scrolling` while the canvas scrolls (shown
again 150 ms after). `Canvas.InsertButton` appears after the pointer rests
at a gap for `delay` (400 ms).

Auto-scroll moves the innermost scroller under the pointer whose edge zone
(a quarter of its size, at most 180 px) holds it, outer scrollers once it
reaches its end, at up to 900 px per second regardless of the frame rate,
ramping up over 400 ms after the pointer enters the zone.

## Frame surface

`surface="frame"` renders the canvas inside a same-origin `srcdoc` iframe:
a real viewport, so media queries, `vw` units and an e-mail's fixed width
behave as on the published page. Blocks, measurement, rings, inline text
and drag and drop work as inline; the editor's stores and context reach
the frame through a portal. The consumer's props (`className`, `style`,
`ref`) go to the element in the host page around the frame.

```tsx
<Canvas.Root
  components={pageBlocks}
  surface="frame"
  frame={{ width: 768, head: '<link rel="stylesheet" href="/site.css">' }}
>
  <Canvas.Overlay>
    <Canvas.SelectionRing />
  </Canvas.Overlay>
  <Canvas.Overlay layer="host">
    <Canvas.BlockToolbar>{/* buttons */}</Canvas.BlockToolbar>
  </Canvas.Overlay>
</Canvas.Root>
```

- **Size.** `frame.width` is the layout width (`full` takes the available
  width); `frame.scale: 'fit'` (default) shrinks a wider frame with
  `transform: scale()` so layout and media queries keep the full width.
  Changing the width resizes the same iframe. `DEFAULT_BREAKPOINTS`,
  `breakpointFor` and `fitScale` help build a device switcher.
- **Height.** `frame.height: 'auto'` (default) follows the content, so the
  frame never scrolls itself (capped at `MAX_AUTO_HEIGHT`). A block sized
  with `100vh` would grow with the frame forever: after ten equal growth
  steps the height freezes and a development build logs `[editor:E012]`.
  A number gives a fixed height that scrolls inside the frame.
- **Head and body.** `frame.head` (markup) and `frame.bodyAttributes` are
  patched into the live document, so a theme or stylesheet change never
  reloads the frame (no white flash, scroll kept). React 19 hoists
  `<link rel="stylesheet" precedence>` rendered by a block into the frame
  head on its own. Never render `html`, `head` or `body` (react-email
  `Html`, `Head`, `Body`) in the frame: React takes over the live shell,
  and a development build logs `[editor:E011]`.
- **Styles.** `frame.styles: 'mirror'` (default) copies the host page's
  `<style>` and stylesheet links into the frame and follows later ones
  (CSS-in-JS included), copying identical content once; the canvas carries
  `data-loading` until mirrored sheets load (at most `stylesTimeout`, then
  `[editor:E013]`). Rules added through CSSOM (`insertRule`) and
  `adoptedStyleSheets` cannot cross into another document; give such
  libraries the frame head as their container instead. `none` mirrors
  nothing.
- **Layers.** `Canvas.Overlay` draws inside the frame by default (rings
  scroll with the content). `layer="host"` draws over the frame in the
  host page, for chrome that may leave the frame: a toolbar of the first
  block sits above the frame. The host layer sets `--editor-scale` for
  strokes that should keep their width when the frame is scaled.
- **Events.** Clicks, hover, links and forms behave as inline. The frame
  document gets the editor's shortcuts and block clipboard itself, since
  its key events never reach the host page. While a builder input in the
  host page takes focus, the frame body is `inert` for a second, so the
  frame never pulls focus back. Drags cross the frame edge both ways: a
  palette drag from the host page drops into the frame (the frame ignores
  the pointer meanwhile), and a drag that starts in the frame keeps
  tracking when the pointer leaves it.
- **Sandbox.** The live frame is not sandboxed: it renders the app's own
  components. With `frame.sandbox` and no `allow-scripts`, WebKit runs no
  listeners and no animation frames in it, so editing stops there
  (`[editor:E014]`).
- **E-mail.** `emailFrame({ sheet, width? })` returns `frame` and
  `wrapper` for live e-mail editing: the compiled e-mail sheet as the only
  styles, no body margin, a centered table around the blocks. Compiled
  output (react-email `<Tailwind>`, render to string) belongs in
  `Editor.FramePreview`; `<Tailwind>` compiles asynchronously and must
  not enter the client bundle.

`useSurface()` returns the `PreviewSurface`: the canvas document and
window, its `scale`, and `toHost(rect)` / `fromHost(point)` between the
canvas's client coordinates and the host page's. An edit in a
1000-block frame measured within the inline cost in Chromium (median
below 1 ms either way); a browser test keeps it under 1.5 times inline.

## Parts

| Part                           | Default element                      | Props                                                                                                                                                                                                                                            | Data attributes                                                                                           |
| ------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `Canvas.Provider`              | none                                 | `children`. Renders no element; owns the drag session shared by every part and `Canvas.Root` below it. Optional.                                                                                                                                 | none                                                                                                      |
| `Canvas.Root`                  | `div`                                | `components` (required), `surface`, `interactive`, `resolve`, `chunkSize`, `renderBlockError`, `renderUnknownBlock`, `clickToEdit`, `frame`, `wrapper`, `children` (overlay), `render`, div props                                                | `data-editor-canvas`, `data-interactive`, `data-dragging`, `data-editing`                                 |
| `data-editor-frame-surface`    | `Canvas.Root` with `surface="frame"` | The element in the host page around the frame; takes the consumer's props.                                                                                                                                                                       |
| `data-editor-host-layer`       | frame surface                        | The host-page layer over the frame (`Canvas.Overlay layer="host"`).                                                                                                                                                                              |
| `data-editor-frame-root`       | inside the frame                     | The mount node in the frame body (`translate="no"`).                                                                                                                                                                                             |
| `data-editor-mirrored`         | frame head                           | A stylesheet copied from the host page.                                                                                                                                                                                                          |
| `data-loading`                 | host                                 | Present while mirrored frame stylesheets load.                                                                                                                                                                                                   |
| `data-editor-email-wrapper`    | `emailFrame` wrapper                 | The centered e-mail table.                                                                                                                                                                                                                       |
| `Canvas.Overlay`               | `div`                                | `layer` (`surface` default, `host`), `render`, div props. Portals into the canvas host, or over a frame into the host-page layer.                                                                                                                | `data-editor-overlay`                                                                                     |
| `Canvas.SelectionRing`         | `div`                                | `render`, div props. Sized from the selected block rect.                                                                                                                                                                                         | `data-editor-selection-ring`, `data-block-type`, `data-can-move`, `data-can-delete`, `data-unresolved`    |
| `Canvas.HoverRing`             | `div`                                | `render`, div props. Hidden while dragging, editing, or when hovered equals selected.                                                                                                                                                            | `data-editor-hover-ring`, `data-block-type`, `data-can-move`, `data-can-delete`, `data-unresolved`        |
| `Canvas.FieldRing`             | `div`                                | `render`, div props. Sized from the focused field rect (own-block only).                                                                                                                                                                         | `data-editor-field-ring`, `data-block-type`, `data-can-move`, `data-can-delete`, `data-unresolved`        |
| `Canvas.BlockToolbar`          | `div`                                | `align`, `side`, `offset`, `render`, div props. Consumer supplies buttons. Shown in `edit` and `select`. Pins inside the visible block when `side="top"` would clip. Named from the catalog (`parts.blockToolbar`), one tab stop, Alt+F10 entry. | `data-editor-block-toolbar`, `data-side`, `data-block-type`                                               |
| `Canvas.InsertButton`          | `button`                             | `placement` (`between` \| `container`), optional `type`, optional `onInsert`, `render`, button props. Shown only in `edit`.                                                                                                                      | `data-editor-insert-button`, `data-orientation`, `data-empty-container`                                   |
| `Canvas.DragHandle`            | `button`                             | `blockId` (required), `render`, button props. Move an existing block by pointer drag. Overlay siblings inset into the visible block; inside `Canvas.BlockToolbar` the handle stays in flow.                                                      | `data-editor-drag-handle`, `data-dragging` on the handle while its block is the move session              |
| `Canvas.PaletteItem`           | `button`                             | `type` (required), optional `properties`, `render`, button props. Click inserts like `Editor.AddBlock`; drag adds by geometry.                                                                                                                   | `data-editor-palette-item`, `data-block-type`, `data-dragging` while this item starts a new-block session |
| `Canvas.DropIndicator`         | `div`                                | `render`, div props. Line or box from the active drop target. Presentational.                                                                                                                                                                    | `data-editor-drop-indicator`, `data-orientation`, `data-variant`, `data-kind` (`new` \| `move`)           |
| `Canvas.DragPreview`           | `div`                                | `render`, div props, optional children. Follows the pointer during a session. Presentational.                                                                                                                                                    | `data-editor-drag-preview`, `data-kind` (`new` \| `move`)                                                 |
| `Canvas.InlineText`            | `div`                                | `suggest`, `discardOnEscape`, `render`, div props. Overlays a contentEditable glass on `text` fields in `edit`; not on `readOnly` fields.                                                                                                        | `data-editor-inline-text`, `data-editing`, `data-block-type`, `data-field`                                |
| `Canvas.ReadonlySubtree`       | `div`                                | `render`, div props. `inert`, `display: contents`; wraps embedded trees that are shown but not edited.                                                                                                                                           | `data-editor-readonly`                                                                                    |
| `Canvas.BlockError`            | `div`                                | `blockId`, `blockType`, `error` (all set by the canvas), `render`, div props; `role="alert"`, carries the block anchor so the block stays selectable and deletable                                                                               | `data-editor-block`, `data-block-error`, `data-block-id`, `data-block-type`                               |
| `Canvas.UnknownBlock`          | `div`                                | `blockId`, `blockType`, `props`, `slots` (set by the canvas), `render`, div props; renders every slot below its label                                                                                                                            | `data-editor-block`, `data-unknown-block`, `data-block-id`, `data-block-type`                             |
| `Canvas.ContextMenu`           | `div` with `role="menu"`             | `commands`, `renderItem(entry, run)`, `render`, div props; fixed at the pointer, focus returns on close                                                                                                                                          | `data-open`                                                                                               |
| `Canvas.DropTargetRing`        | `div`                                | `render`, div props. Outlines the container a drag drops into (its slot element, else its block); `aria-hidden`.                                                                                                                                 | `data-editor-drop-target-ring`, `data-nested`                                                             |
| `Canvas.Label`                 | `div`                                | `render`, div props. The selected block's name: above when it fits, below a block under 250 px, else inside its top (`labelPlacement`); its button opens a breadcrumb of parent and grandparent (click selects, hover highlights).               | `data-placement`, `data-open`                                                                             |
| `Canvas.EmptySlot`             | `div`                                | `blockId`, `slot?`, `onAdd?`, `render`, div props. Render it beside a slot's children: shows only while the slot is empty, in an editing canvas, with a minimum height and an add button (default: select the block, run `ui.quickInsert`).      | `data-editor-empty-slot`, `data-drag-over`                                                                |
| `Canvas.SpacingOverlay`        | `div`                                | `blockId?` (default: the hovered block while Alt and Shift are held), `render`, div props. Padding and margin as strips.                                                                                                                         | `data-box` (`padding`, `margin`), `data-side`                                                             |
| `Canvas.InlineRichTextToolbar` | none (renders its children)          | `children` (default: a button per format the field allows). The toolbar of the running in-place rich text session; renders nothing without one.                                                                                                  | none                                                                                                      |

## Hooks

| Hook               | Returns                  | Notes                                                                                                                                                         |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useResolved`      | `T \| undefined`         | Reads the canvas resolve cache. Throws outside `Canvas.Root`. `undefined` is miss or pending.                                                                 |
| `useBlockRect`     | `CanvasRect \| null`     | Content coordinates of a block id (union of same-id nodes). Throws outside `Canvas.Root`.                                                                     |
| `useFieldRect`     | `CanvasRect \| null`     | Content coordinates of a field on its own block. Throws outside `Canvas.Root`.                                                                                |
| `useEditableField` | `EditableField`          | `(blockId, key)`: in-place plain-text editing of the component's own element. `editable` is false outside an editing canvas; spread `props` onto the element. |
| `useSurface`       | `PreviewSurface \| null` | The canvas surface: document, window, scale, coordinate mapping. Throws outside `Canvas.Root`.                                                                |
| `useInsertTarget`  | `InsertTarget \| null`   | Resolved line or box from pointer and hover. Throws outside `Canvas.Root`. Null in `select` / `none`, while dragging or editing, or without pointer / hover.  |

## Types

| Type                               | Description                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CanvasProviderProps`              | Props of `Canvas.Provider`.                                                                                                                      |
| `CanvasRootProps`                  | Props of `Canvas.Root`.                                                                                                                          |
| `CanvasOverlayProps`               | Props of `Canvas.Overlay`.                                                                                                                       |
| `CanvasSelectionRingProps`         | Props of `Canvas.SelectionRing`.                                                                                                                 |
| `CanvasHoverRingProps`             | Props of `Canvas.HoverRing`.                                                                                                                     |
| `CanvasFieldRingProps`             | Props of `Canvas.FieldRing`.                                                                                                                     |
| `CanvasRingState`                  | `blockType`, `canMove`, `canDelete`, `unresolved` on every ring.                                                                                 |
| `CanvasRect`                       | `{ x, y, width, height }` in canvas content coordinates.                                                                                         |
| `CanvasComponents`                 | Component type to `CanvasComponent`.                                                                                                             |
| `CanvasComponent`                  | One component in a `CanvasComponents` map.                                                                                                       |
| `CanvasComponentProps`             | What a canvas component receives: `id`, `type`, `props`, `children`, `slots`, `edit`.                                                            |
| `BlockErrorInfo`                   | What `renderBlockError` receives: `{ blockId, blockType, error }`.                                                                               |
| `UnknownBlockInfo`                 | What `renderUnknownBlock` receives: `{ blockId, blockType, props, slots }`.                                                                      |
| `CanvasBlockErrorProps`            | Props of `Canvas.BlockError`.                                                                                                                    |
| `CanvasUnknownBlockProps`          | Props of `Canvas.UnknownBlock`.                                                                                                                  |
| `CanvasContextMenuProps`           | Props of `Canvas.ContextMenu`.                                                                                                                   |
| `ContextMenuEntry`                 | A menu row: `{ kind: 'command', id, label, disabled }` or `{ kind: 'select', role, blockId, label }`.                                            |
| `CanvasClickToEdit`                | `'select-and-edit' \| 'select-first'`.                                                                                                           |
| `BlockErrorBoundaryProps`          | Props of `BlockErrorBoundary`: `resetKey`, `fallback(error)`, `onError?`, `onReset?`.                                                            |
| `CanvasResolve`                    | Field kind to `FieldResolver`.                                                                                                                   |
| `FieldResolver`                    | `(value, field) => resolved \| Promise<resolved> \| undefined`.                                                                                  |
| `CanvasReadonlySubtreeProps`       | Props of `Canvas.ReadonlySubtree`.                                                                                                               |
| `CanvasInteractive`                | `'edit' \| 'select' \| 'none'`. Default `'edit'`.                                                                                                |
| `CanvasSurface`                    | `'inline' \| 'frame'`. Default `'inline'`. See Frame surface.                                                                                    |
| `InsertTarget`                     | Resolved insert: `parent` (`{ id, slot }`), `index`, `orientation`, `variant`, `rect`, `allowedTypes`, `nested`.                                 |
| `PreviewSurface`                   | `{ kind, document, window, scale, toHost(rect), fromHost(point), getElementsForNode(id) }`.                                                      |
| `SurfacePoint`                     | `{ x, y }` in client coordinates.                                                                                                                |
| `SurfaceRect`                      | `{ x, y, width, height }` in client coordinates.                                                                                                 |
| `CanvasFrameOptions`               | `frame` of `Canvas.Root`: `head`, `bodyAttributes`, `width`, `height`, `scale`, `styles`, `stylesTimeout`, `maxAutoHeight`, `sandbox`, `title`.  |
| `CanvasFrameWrapper`               | `wrapper` of `Canvas.Root`: a component around the canvas inside the frame.                                                                      |
| `Breakpoint`                       | `{ id, width: number \| 'full', label? }`.                                                                                                       |
| `InsertOrientation`                | `'horizontal'` \| `'vertical'`.                                                                                                                  |
| `InsertVariant`                    | `'line'` \| `'box'`.                                                                                                                             |
| `ResolveInsertAtOptions`           | Injected block rects, slot rects (`getSlotRect(id, slot)`, the element carrying `edit.slot.<name>`) and the row-flow stub for `resolveInsertAt`. |
| `CanvasBlockToolbarProps`          | Props of `Canvas.BlockToolbar`.                                                                                                                  |
| `CanvasInsertButtonProps`          | Props of `Canvas.InsertButton`.                                                                                                                  |
| `CanvasDragHandleProps`            | Props of `Canvas.DragHandle`.                                                                                                                    |
| `CanvasDragPreviewProps`           | Props of `Canvas.DragPreview`.                                                                                                                   |
| `CanvasDropIndicatorProps`         | Props of `Canvas.DropIndicator`.                                                                                                                 |
| `CanvasPaletteItemProps`           | Props of `Canvas.PaletteItem`.                                                                                                                   |
| `PointerStore`                     | External pointer snapshot store on the canvas context.                                                                                           |
| `PointerSnapshot`                  | One pointer sample (client coordinates and target block id).                                                                                     |
| `DragSession`                      | Active pointer drag state (new block or move).                                                                                                   |
| `EditableField`                    | What `useEditableField` returns: `editable`, `editing`, `props`.                                                                                 |
| `PlainTextOptions`                 | `{ multiline, maxLength }`: the plain-text rules of a field.                                                                                     |
| `CanvasInlineTextProps`            | Props of `Canvas.InlineText`.                                                                                                                    |
| `InlineSuggest`                    | Optional `$`-anchored suggest config: `pattern`, `getItems`, `render`.                                                                           |
| `InlineSuggestItem`                | Suggest row: `insertText` plus consumer fields for `render`.                                                                                     |
| `InlineSuggestRenderContext`       | Suggest UI context: items, highlight, query, anchor rect, `accept`.                                                                              |
| `CanvasFileDrop`                   | `fileDrop` of `Canvas.Root`: `{ blockType, field, upload(file), accept? }`.                                                                      |
| `CanvasDropTargetRingProps`        | Props of `Canvas.DropTargetRing`.                                                                                                                |
| `CanvasLabelProps`                 | Props of `Canvas.Label`.                                                                                                                         |
| `CanvasEmptySlotProps`             | Props of `Canvas.EmptySlot`.                                                                                                                     |
| `CanvasSpacingOverlayProps`        | Props of `Canvas.SpacingOverlay`.                                                                                                                |
| `CanvasInlineRichTextToolbarProps` | Props of `Canvas.InlineRichTextToolbar`: `children`.                                                                                             |

## Helpers

`BlockErrorBoundary` is the class boundary every canvas block sits in: it
shows `fallback(error)` after its children threw and renders them again when
`resetKey` changes (`onReset({ reason: 'keys' })`). Use it around blocks
rendered with `renderDocument` from
[`@createcms/react/editor/render`](/docs/reference/react-editor-render) in a
client component.

| Export                    | Description                                                                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resolveInsertAt`         | Pure insert geometry: `(schema, nodes, rootId, startBlockId, x, y, options)`; walks the ancestors and every declared slot that admits the dragged type.                                                          |
| `INSERT_BOX_PAD`          | Padding around an empty container insert box.                                                                                                                                                                    |
| `INSERT_LINE_THICKNESS`   | Hit thickness for line insert targets.                                                                                                                                                                           |
| `adjustMoveIndex`         | `(nodes, id, parent: SlotRef, index)`: index adjustment when moving a block within the same slot.                                                                                                                |
| `blockIdAtPoint`          | Block id under a client point from measured rects.                                                                                                                                                               |
| `createSectionRefBlock`   | `({ resolver, components, schema? })`: the canvas component for `$ref` blocks. The block selects as a whole (`data-kind="ref"`, `data-loading` until resolved); its section renders read-only with `components`. |
| `emailFrame`              | `({ sheet, width?, background? })`: `{ frame, wrapper }` for live e-mail editing.                                                                                                                                |
| `DEFAULT_BREAKPOINTS`     | Mobile 360, tablet 768, desktop 1280, full.                                                                                                                                                                      |
| `breakpointFor`           | `(width, breakpoints?)`: the widest fixed breakpoint not wider than `width` (991 gives 768).                                                                                                                     |
| `fitScale`                | `(available, width)`: the scale that fits `width` into `available`, never above 1 or 0.                                                                                                                          |
| `MAX_AUTO_HEIGHT`         | Cap of an auto-height frame (20000).                                                                                                                                                                             |
| `CONTEXT_MENU_COMMANDS`   | The default command ids of `Canvas.ContextMenu`.                                                                                                                                                                 |
| `rangeSelection`          | `(store, id)`: the Shift+click selection.                                                                                                                                                                        |
| `toggledSelection`        | `(store, id)`: the Mod+click selection.                                                                                                                                                                          |
| `depthParent`             | `(store, id)`: the Alt+click target, `null` at the top level.                                                                                                                                                    |
| `isSelectionClick`        | Whether a click's modifiers select without editing.                                                                                                                                                              |
| `DND_THRESHOLD_PX`        | Pointer distance before a drag session starts.                                                                                                                                                                   |
| `applyTextEdit`           | Apply a DOM text edit to a string value.                                                                                                                                                                         |
| `EMPTY_FIELD_PLACEHOLDER` | Zero-width placeholder injected for empty inline fields.                                                                                                                                                         |
| `normalizePlainText`      | `(text, multiline)`: line endings normalised; line breaks become spaces when single-line.                                                                                                                        |
| `isInlineEditableKind`    | Whether a field kind supports `Canvas.InlineText`.                                                                                                                                                               |
| `labelPlacement`          | `(rect, viewTop, labelHeight?)`: `above`, `below` or `inside` for `Canvas.Label`.                                                                                                                                |
| `LABEL_HEIGHT_PX`         | Height `Canvas.Label` reserves (20).                                                                                                                                                                             |
| `INSERT_BUTTON_DELAY_MS`  | How long the pointer rests at a gap before `Canvas.InsertButton` shows (400).                                                                                                                                    |

## Data attributes

| Attribute                      | Where                                | Meaning                                                                                                                    |
| ------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `data-editor-canvas`           | host                                 | Presence marker.                                                                                                           |
| `data-interactive`             | host                                 | `'edit'`, `'select'`, or `'none'`.                                                                                         |
| `data-dragging`                | host, drag handle, palette item      | Present on the host while any canvas drag session is active; on a handle or palette item while that part owns the session. |
| `data-editing`                 | host, inline glass                   | Present while the local selection has an inline-editing target.                                                            |
| `data-editor-block`            | block root via `edit.block`          | Document-tree block id.                                                                                                    |
| `data-editor-field`            | field element via `edit.field.<key>` | Field key, counted only inside its own block.                                                                              |
| `data-editor-slot`             | slot element via `edit.slot.<name>`  | Slot name; the slot's children render inside this element.                                                                 |
| `data-unresolved`              | block root via `edit.block`; rings   | Present when a resolved value is pending or missing. On a ring: any measured block element for that id has the attribute.  |
| `data-editor-readonly`         | `Canvas.ReadonlySubtree`             | Together with `inert`, excludes the subtree from click-select and measurement.                                             |
| `data-editor-overlay`          | Overlay host                         | Presence marker. `pointer-events: none`; not `aria-hidden`.                                                                |
| `data-editor-block-toolbar`    | `Canvas.BlockToolbar` inner chrome   | Presence marker. `role="toolbar"`.                                                                                         |
| `data-editor-insert-button`    | `Canvas.InsertButton`                | Presence marker.                                                                                                           |
| `data-side`                    | `Canvas.BlockToolbar`                | `'top'` or `'bottom'`.                                                                                                     |
| `data-orientation`             | `Canvas.InsertButton`                | `'horizontal'` or `'vertical'`.                                                                                            |
| `data-empty-container`         | `Canvas.InsertButton`                | Present when the target variant is `box`.                                                                                  |
| `data-editor-drag-handle`      | `Canvas.DragHandle`                  | Presence marker.                                                                                                           |
| `data-editor-palette-item`     | `Canvas.PaletteItem`                 | Presence marker.                                                                                                           |
| `data-editor-drop-indicator`   | `Canvas.DropIndicator`               | Presence marker. `aria-hidden`.                                                                                            |
| `data-editor-drag-preview`     | `Canvas.DragPreview`                 | Presence marker. `aria-hidden`.                                                                                            |
| `data-kind`                    | drop indicator, drag preview         | `'new'` or `'move'`.                                                                                                       |
| `data-variant`                 | `Canvas.DropIndicator`               | `'line'` or `'box'`.                                                                                                       |
| `data-editor-selection-ring`   | `Canvas.SelectionRing`               | Presence marker.                                                                                                           |
| `data-editor-hover-ring`       | `Canvas.HoverRing`                   | Presence marker.                                                                                                           |
| `data-editor-field-ring`       | `Canvas.FieldRing`                   | Presence marker.                                                                                                           |
| `data-block-type`              | rings                                | Store node type. Omitted when the id is unknown.                                                                           |
| `data-can-move`                | rings                                | Present when the block is not the root.                                                                                    |
| `data-can-delete`              | rings                                | Present when the block is not the root.                                                                                    |
| `data-editor-inline-text`      | `Canvas.InlineText` glass            | Presence marker. `role="textbox"`.                                                                                         |
| `data-field`                   | `Canvas.InlineText` glass            | Property key being edited.                                                                                                 |
| `data-editor-handle-menu`      | `Canvas.DragHandle` menu             | The handle's `role="menu"`.                                                                                                |
| `data-editor-drop-target-ring` | `Canvas.DropTargetRing`              | Presence marker. `aria-hidden`.                                                                                            |
| `data-dropped`                 | dropped blocks                       | Present for 700 ms after a drop (the registry flashes them).                                                               |
| `data-count`                   | `Canvas.DragPreview`                 | Blocks the drag moves.                                                                                                     |
| `data-editor-inline-richtext`  | in-place rich text editor            | Presence marker on the editable element of a running session.                                                              |

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
rects and DOM. Helpers: `test/harness.tsx` and `test/fixtures.tsx` (not
test files).

| File                           | Covers                                                                                                                                                                                                                                                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `editor.test.tsx`              | Canvas.Root shares context with Editor.Root; throws outside it. Overlay throw; Canvas namespace keys.                                                                                                                                                                                                                             |
| `renderer.test.tsx`            | Root fragment, component props, slot anchors, unknown type, resolver cache, unresolved keeps the stored value, ReadonlySubtree, intercept, placeholder.                                                                                                                                                                           |
| `resolve.test.ts`              | `canvasEdit` (slot anchors), `NO_EDIT`, resolve cache states (ready, pending, miss, throw, reject), `resolveNodeProperties`, `readResolved`.                                                                                                                                                                                      |
| `anchors.test.ts`              | `slotElements` own-block scoping, a block that is its own slot, readonly skip.                                                                                                                                                                                                                                                    |
| `rect.test.ts`                 | `unionRects`, visible intersection / overlay clip helpers, readonly skip, nested field key own-block lookup.                                                                                                                                                                                                                      |
| `overlay.test.tsx`             | Overlay portal into host, `useBlockRect` callable, SelectionRing / FieldRing presence, HoverRing suppression.                                                                                                                                                                                                                     |
| `insert.test.ts`               | Pure `resolveInsertAt`: column, row, grid wrap, empty box, walk-up `canPlaceIn`, `draggedId` exclusion, globally nearest ancestor, named slots with slot rects.                                                                                                                                                                   |
| `toolbar.test.tsx`             | BlockToolbar / InsertButton throw outside Root, selection and `interactive="none"` gating, overlay chrome keeps hover.                                                                                                                                                                                                            |
| `dnd.test.ts`                  | Pure DnD helpers: `adjustMoveIndex`, `blockIdAtPoint`, store threshold, session vs target subscriptions.                                                                                                                                                                                                                          |
| `dnd-parts.test.tsx`           | DragHandle / PaletteItem / DropIndicator / DragPreview throw outside Root; preview uses translate3d during drag; overlay handle insets with pointer-events; palette click insert; click no-op when placement fails; click after drag; drag threshold; inline-edit does not block the handle; escape cancel; pointerup off handle. |
| `provider.test.tsx`            | Palette outside Root under a Provider renders enabled and click-inserts; palette without Provider and Root throws; plain Root still provides the session.                                                                                                                                                                         |
| `canvas.browser.test.tsx`      | Chromium: host box, heading anchor rect, layout wait, pointer coordinates, click select/focus, select mode, none mode, ring alignment after layout / resize / scroll, nested field key, same-id union.                                                                                                                            |
| `insert.browser.test.tsx`      | Chromium: column / row / grid insert lines, empty container box, toolbar side / align, first-block toolbar stays hittable, insert disabled gating, select mode without insert.                                                                                                                                                    |
| `dnd.browser.test.tsx`         | Chromium: palette drop into empty stack, column and row sibling moves, overlay-anchored handle move, escape cancel, auto-scroll, touch drag, forbidden placement, focus after drop, select mode without drag.                                                                                                                     |
| `provider.browser.test.tsx`    | Chromium: sidebar palette drag into the canvas under a Provider; two canvases under one provider resolve drops on the hovered editable surface.                                                                                                                                                                                   |
| `inline-text.test.ts`          | Pure inline helpers: `applyTextEdit`, placeholder injection, field kind.                                                                                                                                                                                                                                                          |
| `inline-parts.test.tsx`        | InlineText throw outside Root; string vs number activation; nested key; richText click without session; two editors; empty badge commit.                                                                                                                                                                                          |
| `inline-text.browser.test.tsx` | Chromium: glass activation, caret, typing, Enter/Escape, discardOnEscape, nested key, richText click keeps HTML, empty badge, suggest keyboard, two canvases, number field, undo during session.                                                                                                                                  |

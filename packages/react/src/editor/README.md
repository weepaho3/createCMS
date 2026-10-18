# Editor (`@createcms/react/editor`)

Headless editor primitive — schema, state, form and preview layer. Unstyled;
styling happens in the consumer's wrapper components (registry).

## Usage

`Editor.Root` holds the store for one `EditorDocument`; `Editor.Form`
renders every visible field of one block as a complete field. Kinds without
a built-in control (`media`, `reference`, `link`, `custom`) come from the
`fields` map; `custom` controls are registered per custom `kind`:

```tsx
import type {
  AnyEditorSchema,
  EditorDocument,
} from '@createcms/react/editor/core';

import { Editor, useFields } from '@createcms/react/editor';

import { MediaField } from './media-field'; // the consumer's media control

function PageForm({
  schema,
  doc,
}: {
  schema: AnyEditorSchema;
  doc: EditorDocument;
}) {
  return (
    <Editor.Root
      schema={schema}
      defaultValue={doc}
      fields={{ media: MediaField }}
    >
      <Editor.Form blockId={doc.root.id} />
    </Editor.Root>
  );
}
```

The same form by hand, for a custom layout: map over `useFields(blockId)`
and compose the parts yourself.

```tsx
function BlockFields({ blockId }: { blockId: string }) {
  const fields = useFields(blockId);
  return fields.map(({ key }) => (
    <Editor.Field key={key} blockId={blockId} name={key}>
      <Editor.FieldLabel />
      <Editor.FieldControl />
      <Editor.FieldDescription />
      <Editor.FieldError />
    </Editor.Field>
  ));
}
```

## Messages and announcements

Every text of the parts comes from a catalog (`Messages` in
[Editor core](/docs/reference/react-editor-core#messages)): English by
default, then each plugin's `messages`, then `Editor.Root`'s `messages`
(partial, merged deeply). `useMessages()` returns the catalog (English outside
a root), `useShortcutLabel()` a formatter for combos on the editor's
`platform` (`⌘⇧Z` on Apple, `Ctrl+Shift+Z` elsewhere, translated key names
from the catalog). `dir="rtl"` mirrors `start`/`end` alignment.

`Editor.LiveAnnouncer` renders a visually hidden `role="status"`
`aria-live="polite"` region. The editor announces each insert, move and
removal (type label, the block's first text up to 40 characters, 1-based
position and parent), each undo and redo, and start and end of inline
editing. `useAnnounce()` sends your own messages; `describeBlock(schema,
node)` names a block the same way.

The same form by hand, for a custom layout: map over `useFields(blockId)`
and compose the parts yourself.

```tsx
function BlockFields({ blockId }: { blockId: string }) {
  const fields = useFields(blockId);
  return fields.map(({ key }) => (
    <Editor.Field key={key} blockId={blockId} name={key}>
      <Editor.FieldLabel />
      <Editor.FieldControl />
      <Editor.FieldDescription />
      <Editor.FieldError />
    </Editor.Field>
  ));
}
```

`Editor.Root` either creates its store (`EditorRootOwnStoreProps`: `schema`,
`defaultValue`, `genId`, `persistence`, `plugins`, `remotePlacement`, all read
once at mount; render with a different `key` to load another document) or
uses one made with `createEditorStore` (`EditorRootStoreProps`: `store`). An
injected store outlives the root: re-mounts and other roots share it.
`onChange` (every applied change, any origin) and `onError` are read fresh on
every call, so inline handlers are fine. `onDiagnostics` receives what the load pipeline migrated or repaired. `guardUnload` asks before leaving the
page with unsaved changes (default: on when `persistence` is set); the root
also saves when the page is hidden.

`Editor.FieldControl` accepts `render` only; it does not take `className`.

## Parts

| Part                      | Default element                                 | Props                                                                                                                                                                                                                                                                                                                                                                                | Data attributes                                                                                                         |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `Editor.Root`             | none (provider)                                 | `schema` + `defaultValue`, or `store`; `onChange`, `onError`, `onDiagnostics`, `persistence`, `plugins`, `genId`, `remotePlacement`, `fields`, `guardUnload`, `children`                                                                                                                                                                                                             | none                                                                                                                    |
| `Editor.Field`            | `div`                                           | `blockId` (required), `name` (required), `disabled`, `render`, div props                                                                                                                                                                                                                                                                                                             | `data-kind`, `data-required`, `data-invalid`, `data-disabled`, `data-focused`                                           |
| `Editor.FieldLabel`       | `label`                                         | `render`, label props (`children` replaces the spec's `label`)                                                                                                                                                                                                                                                                                                                       | `data-required`, `data-invalid`, `data-disabled`                                                                        |
| `Editor.FieldControl`     | the resolved control (see below)                | `render`                                                                                                                                                                                                                                                                                                                                                                             | none                                                                                                                    |
| `Editor.FieldDescription` | `p`                                             | `render`, p props (`children` replaces the spec's `description`)                                                                                                                                                                                                                                                                                                                     | none                                                                                                                    |
| `Editor.FieldError`       | `p` with `role="alert"`, rendered while invalid | `render`, p props (`children` replaces the joined messages)                                                                                                                                                                                                                                                                                                                          | `data-invalid`                                                                                                          |
| `Editor.Form`             | `div`                                           | `blockId` (required), `disabled`, `autoScroll`, `render`, div props                                                                                                                                                                                                                                                                                                                  | `data-block-type`, `data-block-id`; each named group is a `fieldset[data-group]` with a `legend`                        |
| `Editor.Preview`          | `div`                                           | `render` (required, tree callback), `debounceMs`, div props                                                                                                                                                                                                                                                                                                                          | `data-stale` while a version change is pending                                                                          |
| `Editor.FramePreview`     | `div` wrapping two iframes                      | `render` (required, async compiler), `debounceMs`, `selectable`, `resolveAnchor`, `onIssues`, `onError`, `sandbox`, `title`, div props                                                                                                                                                                                                                                               | `data-loading`, `data-stale`, `data-error`, `data-kind` (`html` or `blob`)                                              |
| `Editor.Outline`          | `div` with `role="tree"`                        | `indent` (16), `render`, div props; named from the catalog (`parts.outline`), `aria-multiselectable`. Rows drag: the top or bottom quarter of a row reorders, its middle nests (a collapsed row opens after 500 ms), left of the last row of a group by whole indents moves out; invalid places show no indicator (`data-editor-outline-drop-indicator`, `data-variant` line or box) | none                                                                                                                    |
| `Editor.OutlineItem`      | `div` with `role="treeitem"`                    | `blockId` (required), `onDelete`, `render`, div props. Render the children only while `expanded` (render state).                                                                                                                                                                                                                                                                     | `data-selected`, `data-depth`, `data-has-children`, `data-expanded`, `data-hovered`, `data-block-id`, `data-block-type` |
| `Editor.OutlineGroup`     | `div` with `role="group"`                       | `blockId` and `slot` (required), `render`, div props. Wraps one slot's rows; `aria-label` is the slot's `label`, else its name                                                                                                                                                                                                                                                       |                                                                                                                         |
| `Editor.AddBlock`         | `button`                                        | `type` (required), `parentId`, `slot`, `index`, `render`, button props (`children` replaces the palette label). Disabled while `canPlaceIn` refuses the target                                                                                                                                                                                                                       | `data-block-type`                                                                                                       |
| `Editor.Slot`             | none (fragment)                                 | `name` (required), `fallback`, `props`: renders each plugin's `slots[name]` in plugin order                                                                                                                                                                                                                                                                                          | none                                                                                                                    |
| `Editor.LiveAnnouncer`    | `div` with `role="status"`                      | div props; visually hidden, `aria-live="polite"`, one per editor                                                                                                                                                                                                                                                                                                                     | `data-editor-live-announcer`                                                                                            |
| `Editor.ErrorSummary`     | `div` with `role="alert"`                       | `render`, div props; children replace the list. Shown while a `beforeSave` gate blocked the last save: takes focus on appear; each entry selects its block and focuses the field's control.                                                                                                                                                                                          | `data-count`                                                                                                            |
| `Editor.ShortcutHelp`     | `div` with `role="dialog"`                      | `open`, `defaultOpen`, `onOpenChange`, `render`, div props; children replace the list. Opens on `ui.shortcutHelp` (`?`, `Mod+/`), Escape closes and returns focus.                                                                                                                                                                                                                   | `data-open`                                                                                                             |

`Editor.Root` either creates its store (`EditorRootOwnStoreProps`: `schema`,
`defaultValue`, `genId`, `persistence`, `plugins`, `remotePlacement`, all read
once at mount; render with a different `key` to load another document) or
uses one made with `createEditorStore` (`EditorRootStoreProps`: `store`). An
injected store outlives the root: re-mounts and other roots share it.
`onChange` (every applied change, any origin) and `onError` are read fresh on
every call, so inline handlers are fine. `onDiagnostics` receives what the load pipeline migrated or repaired. `guardUnload` asks before leaving the
page with unsaved changes (default: on when `persistence` is set); the root
also saves when the page is hidden.

`Editor.Preview` subscribes to the store `version` and passes the raw store
document (`getDocument()`) to `render` after a delay (default 100 ms, then one
animation frame; `debounceMs={0}` still waits one frame). The consumer maps
that document (for example a `BlocksRenderer` or a PDF viewer). `data-stale` is
present while an update is pending. `render` is the tree callback, not a
host swap: the host is always a `div`.

`Editor.FramePreview` compiles the raw store tree through
`render(tree, { signal })` after the same delay. `render` is typically a
Server Action (email HTML) or an in-browser compile (WASM PDF). The
callback receives the raw tree; the consumer resolves unsaved state
themselves (for example a `resolveTree` POST) before compiling. A string
result is shown as `srcDoc`; a Blob is shown as an object URL. The host is
always a `div` wrapping two stacked iframes. `data-stale` is present while
a newer version is pending; `data-loading` while a compile for the current
version is in flight; `data-error` when the latest non-aborted compile
failed; `data-kind` is `html` or `blob` after the first successful display.
`title` (default `"Preview"`) is the accessible name of both iframes, not a
div title.

The default sandbox is empty. `selectable` adds `allow-same-origin` so
clicks can be read. Scripts, forms and top navigation stay out of the
sandbox (those tokens are stripped if passed). `selectable` is HTML only:
a click on `[data-editor-block]` / `[data-editor-field]` (or a
`resolveAnchor` hit) writes `store.select` / `store.focus`. Blob output has
no reverse click. `onIssues` runs after an HTML compile with
`relative-url` (relative `src`/`href`), `missing-href` (an `a` without
`href`), and one `preview-anchors` when leftover `data-editor-*`
attributes remain. Send-time HTML must not carry editor anchors.

`Editor.Form autoScroll` scrolls this form into view on each store focus
change that targets its `blockId` (`scrollIntoView` with `block: 'nearest'`;
`behavior: 'auto'` when `prefers-reduced-motion: reduce`). The form is
registered as a scroll target even when `autoScroll` is false, so
`useEditor().scrollTo(blockId)` can find it. A custom Form `render` that is
a function must forward `props.ref`.

`Editor.Field` owns one property of one block: it reads the spec and the
value, validates the value on every change (`validateField`), writes through
`setValue` with `coalesce: true` (typing is one undo step), mirrors the
store's focused field (`data-focused`) and calls `store.focus` when focus
enters the field and it is not already the focused one. Every part below it
reads `useFieldContext()`. A key the block's type does not declare renders
nothing and warns once (dev only).

Accessibility wiring, per part:

- `Editor.FieldLabel` is a `<label htmlFor>` pointing at the control's `id`.
- `Editor.FieldDescription` renders `<p id>`; the control lists that id in
  `aria-describedby`. Without a description (spec or children) it renders
  nothing and registers nothing.
- `Editor.FieldError` renders `<p role="alert" id>` only while the field is
  invalid; the control lists that id in `aria-describedby` for exactly that
  time. A custom `render` reads the structured findings from
  `useFieldContext().errors` (the state carries `invalid` only).
- Controls set `aria-invalid="true"` while invalid and omit the attribute
  otherwise. They set `aria-required="true"` when the spec is `required`
  and omit the attribute otherwise.

### Field controls

`Editor.FieldControl` resolves the control in this order:

1. its `render` prop, a function receiving `AnyFieldControlProps`;
2. `fields[spec.type]` from `Editor.Root`'s `fields` map (`FieldControls`,
   typed per kind: the `select` entry receives `FieldControlProps<'select'>`
   with `spec.options`, the `list` entry `spec.of` and `renderElement`, the
   `object` entry `spec.fields` and `renderNested`), or `fields.custom[kind]`
   for a `custom` field;
3. the built-in default for the kind (`defaultFieldControls`).

`media`, `reference`, `link` and `custom` have no default: without a map
entry the part renders nothing and warns once (dev only). Fields hidden by
`hidden` or `when` are left out of `useFields` and `Editor.Form`; a
`readOnly` field passes `readOnly: true` to its control and the field part
carries `data-read-only`. The built-in defaults are unstyled native elements:

| Kind                  | Default element                                               | Value handling                                                                                                                                           |
| --------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`                | `<input type="text">`                                         | `placeholder`, `minLength`, `maxLength` from the field; `readOnly`.                                                                                      |
| `textarea`            | `<textarea>`                                                  | `placeholder`, `minLength`, `maxLength`; `readOnly`.                                                                                                     |
| `richText`            | `<textarea>`                                                  | the HTML source as plain text.                                                                                                                           |
| `number`              | `<input type="number">`                                       | `min`/`max`/`step` from the field; an empty input clears the prop.                                                                                       |
| `boolean`             | `<input type="checkbox">`                                     | `checked` is the value (`false` when unset).                                                                                                             |
| `date`                | `<input type="datetime-local">`                               | ISO-8601 UTC in the store, local minutes in the input (`toDatetimeLocal`/`fromDatetimeLocal`); an empty input clears the prop.                           |
| `color`               | `<input type="color">`                                        | the CSS color string.                                                                                                                                    |
| `select`              | `<select>` (`multiple` for multiple selects)                  | a leading empty option (`placeholder` as its text) plus the `options`; the empty option clears the prop. With `multiple` the value is the selected list. |
| `list`                | `<div role="group">` with an `<ol>` of rows and an Add button | one row per element: the element control, then Move up / Move down / Remove; `min`/`max` disable Remove/Add; a new element is `emptyListElement(of)`.    |
| `object`              | `<div role="group">` with one nested control per field        | nested controls resolve through the same map; a change writes the whole object.                                                                          |
| `Editor.MoveToDialog` | `div` with `role="dialog"`                                    | `blockId`, `onClose`, `render`, div props: pick a slot, then a position; Escape closes. `Canvas.DragHandle`'s menu opens it.                             | `data-step` (`slot`, `position`) |

Every control, built-in or custom, receives `FieldControlProps<K>`: `spec`,
`value` (the kind's wide value or `undefined`), `onChange(next)`
(`undefined` clears the prop), `id`, `name`, `required`, `disabled`,
`readOnly`, `invalid`, `describedBy`, for `list` also `renderElement` and
for `object` also `renderNested`. A control sets
`id` on its focusable element (that is what `FieldLabel` points at) and
forwards `aria-describedby={describedBy}`,
`aria-invalid={invalid || undefined}` and
`aria-required={required || undefined}` itself; the built-ins do.

List elements go through the same map/defaults: `renderElement(props)`
receives `ListElementControlProps` (the element spec widened to a labelled
spec, `{ ...spec.of, label }` with the field label plus the 1-based index,
the element `value`, `onChange`, `id`, `name`, `index`, `disabled`,
`invalid`, `describedBy`) and renders the control registered for
`spec.of.type`. For a list the field `id` sits on the group container, so
`FieldLabel` names the group and each row's element control has its own id
`${id}-${index}`. Element-level findings appear in the field's `FieldError`
with their `index`.

Helpers: `toDatetimeLocal(iso)` (ISO to `datetime-local` value, `''` for
missing/invalid), `fromDatetimeLocal(local)` (`datetime-local` value to ISO
UTC, `undefined` for empty/invalid), `emptyListElement(of)` (`0` for
`number`, `false` for `boolean`, the first option for `select`, `''`
otherwise), `defaultFieldControls` (the built-in map).

### Structure parts

`Editor.OutlineItem` is a keyboard-operable tree row for one block (never the
root). Nest rows in the DOM so a parent contains its children, and wrap the
tree in `Editor.Outline` (`role="tree"`) so arrow navigation stays inside
that outline. Render a row's children only while its render state has
`expanded`.

Keys: see Keyboard. Roving `tabIndex`: `0` when the row is selected, or when
nothing is selected and this is the first child of the root; otherwise `-1`.

`aria-selected` follows the selection, `aria-level` is the depth (root
children are 1), `aria-setsize`/`aria-posinset` the row's place among its
siblings, and `aria-expanded` (only on rows with children) follows the
session's `collapsed` list; selecting a block expands its ancestors.

`Editor.OutlineGroup` wraps the rows of one slot when a block holds more
than the `children` slot: a `role="group"` labelled with the slot's `label`
(else its name). Render one group per name from `useSlots(blockId)` and the
rows from `useSlot(blockId, slot)`.

`Editor.AddBlock` inserts a palette type at the selection point and selects
the new id. With `parentId`, it goes into that block's `slot` (default
`children`). When `parentId` is omitted: the selected block if it accepts
`type` (append), else after the selected block in its slot, else the root
(append); see `insertPointFor`. The button is disabled when `canPlaceIn`
refuses the target (wrong type, full slot).
There is no drag and drop.

## Keyboard

| Where                         | Keys                                   | Action                                                                                            |
| ----------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Field controls                | Tab / Shift+Tab                        | Native tab order. Typing edits the value (one undo step via `coalesce`).                          |
| `Editor.OutlineItem`          | Click                                  | Select the row.                                                                                   |
| `Editor.OutlineItem`          | ArrowUp / ArrowDown                    | Select and focus the previous/next visible row (rows inside a collapsed row are skipped).         |
| `Editor.OutlineItem`          | Alt+ArrowUp / Alt+ArrowDown            | Move among siblings.                                                                              |
| `Editor.OutlineItem`          | ArrowRight / ArrowLeft                 | Expand, then move to the first child; collapse, then move to the parent row (mirrored for `rtl`). |
| `Editor.OutlineItem`          | Home / End                             | First / last visible row.                                                                         |
| `Editor.OutlineItem`          | `*`                                    | Expand every sibling.                                                                             |
| `Editor.OutlineItem`          | Printable characters                   | Type-ahead: the next row whose text starts with the letters typed within 500 ms.                  |
| `Editor.OutlineItem`          | Delete / Backspace                     | Remove after `onDelete` (return `false` to keep).                                                 |
| `Editor.OutlineItem`          | Escape                                 | Clear the selection.                                                                              |
| `useEditorKeyboard(scopeRef)` | Mod+Z / Mod+Shift+Z or Ctrl+Y          | Undo / redo (also inside inputs).                                                                 |
| `useEditorKeyboard(scopeRef)` | Mod+C / Mod+X / Mod+V                  | Copy, cut, paste blocks through the browser's clipboard events.                                   |
| `useEditorKeyboard(scopeRef)` | Mod+Alt+C / Mod+Alt+V                  | Copy props, paste them onto selected blocks of the same type.                                     |
| `useEditorKeyboard(scopeRef)` | Mod+D (or Mod+Shift+D)                 | Duplicate the selected block.                                                                     |
| `useEditorKeyboard(scopeRef)` | Delete / Backspace                     | Remove the selected block, select its neighbour.                                                  |
| `useEditorKeyboard(scopeRef)` | Alt+ArrowUp / Alt+ArrowDown            | Move the selected block among its siblings.                                                       |
| `useEditorKeyboard(scopeRef)` | Mod+G                                  | Wrap the selected block in the first container type that fits.                                    |
| `useEditorKeyboard(scopeRef)` | Escape / Shift+Enter                   | Select the parent; at the top level clear the selection.                                          |
| `useEditorKeyboard(scopeRef)` | Enter                                  | Select the first child.                                                                           |
| `useEditorKeyboard(scopeRef)` | Tab / Shift+Tab                        | Select the next / previous sibling; at the ends the key moves focus as usual.                     |
| `useEditorKeyboard(scopeRef)` | Mod+A                                  | Select the selected block and all its siblings.                                                   |
| `useEditorKeyboard(scopeRef)` | Mod+K, `/`, Alt+F10, `?` or Mod+/      | `ui` event: command palette, quick insert, block toolbar (also from inline text), shortcut help.  |
| `useEditorKeyboard(scopeRef)` | Plugin combos                          | The bound command. A plugin combo replaces a default; `''` unbinds it.                            |
| `Canvas.InlineText`           | Enter (no Shift)                       | End the inline session (commit).                                                                  |
| `Canvas.InlineText`           | Escape                                 | End the session; with `discardOnEscape`, restore the value from session start.                    |
| `Canvas.InlineText`           | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y | Store undo/redo during the session (`preventDefault` on the glass).                               |

The listener is a bubbling `keydown` on the document, ignored unless the
target is inside `scopeRef.current`. A consumer `onKeyDown` that
`preventDefault`s skips the built-in handling. `Editor.Root` renders no DOM,
so the consumer puts the ref on their shell and calls the hook under `Root`.
Undo/redo run even inside inputs. Optional Delete/Escape do not. There is no
drag and drop in `/editor`.

## ARIA

| Attribute                       | On                                  | Rule                                                                                                                   |
| ------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `aria-describedby`              | the control's focusable element     | Space-joined ids of the mounted description and, while invalid, the error. Omitted when empty.                         |
| `aria-invalid`                  | the control's focusable element     | `"true"` while `validateField` reports a finding; omitted when valid (never `"false"`).                                |
| `aria-required`                 | the control's focusable element     | `"true"` when the spec is `required`; omitted otherwise. Native `required` is also set on built-in controls.           |
| `role="alert"`                  | `Editor.FieldError`                 | Rendered only while invalid.                                                                                           |
| `htmlFor` / `id`                | `Editor.FieldLabel` / control       | Label points at the control id from `useId`.                                                                           |
| `aria-selected`                 | `Editor.OutlineItem`                | Follows the local user's selected block.                                                                               |
| `aria-level`                    | `Editor.OutlineItem`                | Depth; root children are 1.                                                                                            |
| `aria-expanded`                 | `Editor.OutlineItem`                | Only on rows with children: `"false"` while collapsed (`store.setCollapsed`); selecting a block expands its ancestors. |
| `aria-setsize`, `aria-posinset` | `Editor.OutlineItem`                | The row's siblings in its slot and its position among them.                                                            |
| `role="treeitem"`               | `Editor.OutlineItem`                | Default. Wrap the tree in `[role="tree"]`.                                                                             |
| `data-required`                 | `Editor.Field`, `Editor.FieldLabel` | Present when the spec is `required` (styling hook; not a substitute for `aria-required`).                              |

## Focus

| Event                                                          | Focus                                                                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Tab into a field                                               | `store.focus({ blockId, key })` once (not on every keystroke). `data-focused` mirrors that.                                   |
| Click a preview anchor in `Editor.FramePreview` (`selectable`) | `store.select` / `store.focus`; the matching `[data-editor-block]` gets `data-editor-focused` and scrolls into view.          |
| `Editor.Form autoScroll`                                       | The form host scrolls into view (`block: 'nearest'`) on each store focus change that targets that form.                       |
| Delete/Backspace on `Editor.OutlineItem`                       | Neighbour row (next treeitem outside this subtree, else previous) is selected and focused; no neighbour clears the selection. |
| Alt+Arrow reorder on `Editor.OutlineItem`                      | Focus is restored on the moved row after the DOM move.                                                                        |
| `useEditorKeyboard` commands                                   | Store only; the router does not move DOM focus.                                                                               |
| Store focus set by a click in the canvas or a preview          | `Editor.Field` moves DOM focus into its control after the click, unless inline editing started or another input has focus.    |
| Pointer over `Editor.Field`                                    | Hovers its block, so the canvas and preview highlight it.                                                                     |
| A selection made outside the outline                           | The row scrolls into view (`block: 'nearest'`) without taking focus.                                                          |
| Escape on `Editor.OutlineItem`                                 | Selection cleared; focus stays.                                                                                               |

A canvas that is not interactive sets `inert` on its surface so pointer and
keyboard do not reach the host markup. Motion (rings, indicators, reorder)
honours `prefers-reduced-motion: reduce` by skipping animation and applying
the end state immediately.

## Hooks

| Hook                   | Returns                                        | Notes                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useEditorContext`     | `EditorContextValue`                           | Throws when used outside `Editor.Root`. Internal-facing.                                                                                                                                                                                                                                                                               |
| `useDocSelector`       | `T` (from `selector(state, store)`)            | A slice of the document scope (`DocState`); wakes only on document changes; returns the previous reference when the selected value is shallow-equal (`shallowEqual`).                                                                                                                                                                  |
| `useSessionSelector`   | `T`                                            | A slice of the session scope (`SessionState`: selection, focus, editing, mode, history, save); never woken by hover or document-only changes.                                                                                                                                                                                          |
| `useEphemeralSelector` | `T`                                            | A slice of the ephemeral scope (`EphemeralState`: hover).                                                                                                                                                                                                                                                                              |
| `useEditorStore`       | `EditorStore`                                  | No subscription: imperative access to the enclosing `Editor.Root`'s store.                                                                                                                                                                                                                                                             |
| `useEditor`            | `EditorApi` (no args) or `T` (with a selector) | No-arg form returns a stable object (`{ ...store, store, scrollTo }`); with a selector, a reactive slice of the document scope. `scrollTo(blockId, opts?)` scrolls the registered form, or `[data-block-id]` inside `opts.container` when that option is set (no registry fallback). Returns `false` when the target is missing.       |
| `useAnyBlock`          | `AnyBlockHandle \| null`                       | `null` for an unknown or `null` id; the handle is stable while the node is unchanged.                                                                                                                                                                                                                                                  |
| `useAnyField`          | `AnyFieldHandle`                               | Re-renders only when that property's value or the node's type changes.                                                                                                                                                                                                                                                                 |
| `useFields`            | `SchemaField[]`                                | The block's property specs in schema order; `[]` for an unknown block; stable array identity.                                                                                                                                                                                                                                          |
| `useChildren`          | `readonly ChildRef[]`                          | The `children` slot: `{ id, type, index }` in order; same array reference until ids or types change.                                                                                                                                                                                                                                   |
| `useSlot`              | `readonly ChildRef[]`                          | `useSlot(parentId, slot)`: the children of one slot, like `useChildren`; re-renders only when that slot's ids or types change.                                                                                                                                                                                                         |
| `useSlots`             | `readonly string[]`                            | `useSlots(parentId)`: the slot names a block holds, declared slots first, then the rest alphabetically.                                                                                                                                                                                                                                |
| `useBlockActions`      | `BlockActions`                                 | Placement-gated `add`/`remove`/`duplicate`/`moveUp`/`moveDown`/`moveTo(parent, index)` plus `canMoveUp`, `canMoveDown`, `canHaveChildren`, `allowedChildTypes`.                                                                                                                                                                        |
| `useSelection`         | `SelectionState`                               | `{ selected, selection, focus, editing }` from the session scope.                                                                                                                                                                                                                                                                      |
| `useHovered`           | `string \| null`                               | The hovered block; re-renders only on hover changes.                                                                                                                                                                                                                                                                                   |
| `useNodeStatus`        | `NodeStatus`                                   | `useNodeStatus(id)`: the block's `resolveData` state `{ loading, error }`. `Editor.Form` mirrors it as `data-loading` / `data-error`.                                                                                                                                                                                                  |
| `useComputed`          | `Record<string, JsonValue>`                    | `useComputed(id)`: the block's `resolveData` result (`{}` before the first one); never part of the document.                                                                                                                                                                                                                           |
| `useHistory`           | `HistoryApi`                                   | `{ canUndo, canRedo, undo, redo }`.                                                                                                                                                                                                                                                                                                    |
| `useEditorKeyboard`    | `void`                                         | `useEditorKeyboard(scopeRef)`: binds `bindEditorKeyboard` and `bindEditorClipboard` on the scope's document for events inside `scopeRef.current`. A consumer `onKeyDown` that `preventDefault`s skips the built-in handling. Throws outside `Editor.Root`.                                                                             |
| `useSave`              | `SaveApi`                                      | `{ status, dirty, saving, error, conflict, save }`.                                                                                                                                                                                                                                                                                    |
| `useSaveConflict`      | `SaveConflictApi \| null`                      | During a save conflict: `{ serverDoc, localDoc, reload(), overwrite(), copyMine() }`; `null` otherwise.                                                                                                                                                                                                                                |
| `useCommand`           | `CommandApi \| null`                           | `useCommand(id)`: a UI command with `label`, `canExecute`, `shortcut`, `run(args?)`; `null` for an unknown id.                                                                                                                                                                                                                         |
| `useCommands`          | `readonly EditorCommand[]`                     | Every UI command: built-ins, then plugin commands.                                                                                                                                                                                                                                                                                     |
| `useDirty`             | `boolean`                                      | Unsaved local changes (`useSave().dirty`).                                                                                                                                                                                                                                                                                             |
| `usePalette`           | `PaletteItem[]`                                | Every insertable block type, memoised per schema.                                                                                                                                                                                                                                                                                      |
| `useMissingRequired`   | `MissingRequiredField[]`                       | Every `required` property left empty across the document (blocks and root); memoised per `nodes` identity.                                                                                                                                                                                                                             |
| `useFieldContext`      | `FieldContextValue`                            | The enclosing `Editor.Field`'s spec, value, `setValue`, ids, `errors`, flags; throws outside `Editor.Field`.                                                                                                                                                                                                                           |
| `bindEditorKeyboard`   | `() => void`                                   | `(store, doc, scope?)`: routes `keydown` on `doc` through `handleEditorKey`; bind it once per document (host page, each same-origin preview frame: `Editor.FramePreview` does this for its frame). Returns the unbind function.                                                                                                        |
| `handleEditorKey`      | `boolean`                                      | `(store, event)`: runs the command bound to the event's combo (`combosOf`). Skips composition, prevented events, plain keys from widgets (buttons, tree items, menus, toolbars, dialogs) and every command not marked `editable` while focus is in an input or editable text; a command that cannot run leaves the key to the browser. |
| `bindEditorClipboard`  | `() => void`                                   | `(store, doc, scope?)`: handles `copy`, `cut` and `paste` for blocks (see Clipboard in the core reference). Inputs, editable text and selected text stay with the browser.                                                                                                                                                             |
| `useRovingFocus`       | `RovingFocus`                                  | One tab stop for a group of controls (APG toolbar and menu): `ref`, `onKeyDown`, `onFocus`, `focus()`. Arrows (mirrored for `rtl`), Home and End; items are buttons, links, form controls, menu items and `data-roving-item` elements.                                                                                                 |
| `useShortcutList`      | `readonly ShortcutEntry[]`                     | Every bound command with its platform labels, for a custom help dialog or command palette.                                                                                                                                                                                                                                             |
| `useMessages`          | `Messages`                                     | The merged catalog of the enclosing root; English outside one.                                                                                                                                                                                                                                                                         |
| `useShortcutLabel`     | `(combo) => string`                            | Formats `Mod+Shift+z` for the root's platform and catalog.                                                                                                                                                                                                                                                                             |
| `useAnnounce`          | `(message) => void`                            | Speaks a message through `Editor.LiveAnnouncer`.                                                                                                                                                                                                                                                                                       |
| `useSaveIssues`        | `readonly ErrorSummaryEntry[]`                 | The findings of the last blocked save, formatted from the catalog (block, field, message).                                                                                                                                                                                                                                             |
| `useSection`           | `ResolvedSection \| null`                      | `(resolver, ref, overrides?)`: a `$ref` block's resolved section, `null` while loading.                                                                                                                                                                                                                                                |
| `useSectionOverrides`  | `readonly SectionOverrideEntry[]`              | `(blockId, resolver)`: the section props its components expose, with the current override and `set(value)` (`undefined` removes it): what an inspector offers for a `$ref` block.                                                                                                                                                      |
| `useMoveTargets`       | `{ targets, moveTo }`                          | `(blockId)`: every slot the block may move into (document order, with label, depth and count) and `moveTo(parent, index)`: the logic of a move-to dialog.                                                                                                                                                                              |

## createEditor(options)

`createEditor({ schema })` binds `Editor.Root`, `Preview`, `FramePreview`
and every hook above (including `useEditorKeyboard`) to one schema: `Root`
has `schema` pre-set and `defaultValue` typed as `DocumentOf<typeof schema>`;
`Preview`'s `render` callback receives `DocumentOf<typeof schema>`;
`FramePreview`'s `render` callback receives `DocumentOf<typeof schema>` plus
`{ signal }`; `useBlock`/`useField` narrow on the schema's
declared block types; `useChildren` returns `ChildRefOf<S>[]` and
`useBlockActions` returns `TypedBlockActions<S>`; `add` and `usePalette`
resolve to `never` for a schema without statically known blocks. Every
returned hook first checks that the enclosing `Editor.Root` uses the SAME
schema object (`===`) and throws otherwise, so a nested editor or a generic
route under a different schema gets a precise error instead of a silently
wrong type.

```tsx
const pageEditor = createEditor({ schema: pages });

// <pageEditor.Root defaultValue={tree} persistence={{ save: savePage }}>{children}</pageEditor.Root>

function Toolbar({ parentId }: { parentId: string }) {
  const { add } = pageEditor.useEditor();
  return (
    <button onClick={() => add('hero', { parent: { id: parentId } })}>
      Add hero
    </button>
  );
}

function Block({ id }: { id: string }) {
  const block = pageEditor.useBlock(id);
  if (block?.type === 'hero') {
    return <button onClick={() => block.set('headline', 'x')}>Edit</button>;
  }
  return null;
}
```

| Type                     | Description                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `DocumentOf<S>`          | A typed `EditorDocument` of `S`.                                                              |
| `NodeOf<S>`              | One typed node of `S`, a union over its component types.                                      |
| `BlockTypeOf<S>`         | The block type names of `S`; `never` for a block-less or dynamic schema.                      |
| `BlockPropsOf<S, K>`     | The property values of block `K` (or `'root'`).                                               |
| `RootPropsOf<S>`         | `BlockPropsOf<S, 'root'>`.                                                                    |
| `ComponentsOf<S>`        | The statically known components of `S`; `{}` for an index-signature map.                      |
| `PropsSpecOf<S, K>`      | The property specs of block `K` (or `'root'`).                                                |
| `PropsOf<TSpec>`         | The raw property values of a spec record.                                                     |
| `PropValueOf<TSpec, P>`  | The value type of one property `P` in `TSpec`.                                                |
| `BlockHandle<K, TSpec>`  | A typed block handle for block type `K` with property specs `TSpec`.                          |
| `BlockHandleOf<S>`       | The discriminated union over every block handle of `S`, plus the root handle.                 |
| `FieldHandle<V, Spec>`   | A typed field handle: value, spec and setter of one property.                                 |
| `FieldHandleOf<S, K, P>` | `FieldHandle` for property `P` of block type `K` (or `'root'`) in `S`.                        |
| `TypedEditorApi<S>`      | `useEditor()`'s return type, with `add` restricted to `S`'s block types.                      |
| `TypedAddOptions<S, K>`  | `add`'s options for block type `K`: `parent: SlotTarget`, optional `index`, optional `props`. |
| `TypedPaletteItems<S>`   | `PaletteItem[]` with `type` narrowed; `never` when `S` has no static blocks.                  |
| `ChildRefOf<S>`          | `ChildRef` with `type` narrowed to `S`'s block types.                                         |
| `TypedBlockActions<S>`   | `BlockActions` with `add` and `allowedChildTypes` restricted to `S`'s block types.            |
| `EditorTypes<S>`         | Phantom bag of the derived types (`typeof editor.types.document`, …); `{}` at runtime.        |
| `EditorFactory<S>`       | What `createEditor` returns.                                                                  |
| `CreateEditorOptions<S>` | `createEditor`'s options: `{ schema: S }`.                                                    |

## Core

Schema helpers and the store are the React-free subpath
`@createcms/react/editor/core`; see [`core/README.md`](./core/README.md).

## Types

| Type                          | Description                                                                                                                                                           |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EditorRootProps`             | Props of `Editor.Root`: `EditorRootOwnStoreProps` or `EditorRootStoreProps`.                                                                                          |
| `EditorRootOwnStoreProps`     | `Editor.Root` creating its store from `schema` and `defaultValue`.                                                                                                    |
| `EditorRootStoreProps`        | `Editor.Root` using an injected `store`.                                                                                                                              |
| `EditorSlotProps`             | Props of `Editor.Slot`: `name`, `fallback?`, `props?`.                                                                                                                |
| `EditorContextValue`          | What `Editor.Root` shares with its parts (`schema`, `store`, `fields`, `registerScrollTarget`, `scrollTo`).                                                           |
| `DocSelector`                 | A `useDocSelector` selector: `(state: DocState, store) => T`.                                                                                                         |
| `SessionSelector`             | A `useSessionSelector` selector: `(state: SessionState, store) => T`.                                                                                                 |
| `EphemeralSelector`           | A `useEphemeralSelector` selector: `(state: EphemeralState, store) => T`.                                                                                             |
| `SelectionState`              | `useSelection`'s return type: `{ selected, selection, focus, editing }`.                                                                                              |
| `SaveConflictApi`             | `useSaveConflict`'s return type.                                                                                                                                      |
| `CommandApi`                  | `useCommand`'s return type.                                                                                                                                           |
| `EditorApi`                   | `useEditor()`'s return type: the store's methods plus `store` and `scrollTo`.                                                                                         |
| `EditorScrollToOptions`       | `scrollTo` options: `ScrollIntoViewOptions` plus optional `container`.                                                                                                |
| `EditorPreviewProps`          | Props of `Editor.Preview`: `render(tree)`, `debounceMs?`, div props.                                                                                                  |
| `EditorFramePreviewProps`     | Props of `Editor.FramePreview`: `render(tree, { signal })`, `debounceMs?`, `selectable?`, `resolveAnchor?`, `onIssues?`, `onError?`, `sandbox?`, `title?`, div props. |
| `FramePreviewIssue`           | One `onIssues` finding: `relative-url`, `missing-href`, or `preview-anchors`.                                                                                         |
| `FramePreviewAnchor`          | `{ blockId, key?, slot? }` resolved from a click in a selectable frame.                                                                                               |
| `FramePreviewKind`            | `'html'` or `'blob'`, the last successfully displayed compile kind.                                                                                                   |
| `AnyBlockHandle`              | `useAnyBlock`'s return type: a block's data, specs and setters.                                                                                                       |
| `AnyFieldHandle`              | `useAnyField`'s return type: one property's value, spec and setter.                                                                                                   |
| `HistoryApi`                  | `useHistory`'s return type: `{ canUndo, canRedo, undo, redo }`.                                                                                                       |
| `SaveApi`                     | `useSave`'s return type: `{ status, dirty, saving, error, conflict, save }`.                                                                                          |
| `EditorFieldProps`            | Props of `Editor.Field`: `blockId`, `name`, `disabled?`, `render?`, div props.                                                                                        |
| `EditorFieldLabelProps`       | Props of `Editor.FieldLabel`: `render?`, label props.                                                                                                                 |
| `EditorFieldControlProps`     | Props of `Editor.FieldControl`: `render?(props: AnyFieldControlProps)`.                                                                                               |
| `EditorFieldDescriptionProps` | Props of `Editor.FieldDescription`: `render?`, p props.                                                                                                               |
| `EditorFieldErrorProps`       | Props of `Editor.FieldError`: `render?`, p props.                                                                                                                     |
| `EditorFormProps`             | Props of `Editor.Form`: `blockId`, `disabled?`, `autoScroll?`, `render?`, div props.                                                                                  |
| `FieldControlProps<K>`        | What a control of kind `K` receives (`spec`, `value`, `onChange`, ids, flags).                                                                                        |
| `AnyFieldControlProps`        | The wide form (`spec: BlockProperty`, `value: unknown`) `render` receives.                                                                                            |
| `FieldControls`               | The `fields` map of `Editor.Root`: one optional control component per kind.                                                                                           |
| `FieldContextValue`           | What `Editor.Field` shares with the parts below it (`useFieldContext`).                                                                                               |
| `ListElementControlProps`     | What a list element's control receives (`spec`, `value`, `index`, ...).                                                                                               |
| `ListElementRender`           | `(props: ListElementControlProps) => ReactElement \| null`, passed to `list` controls.                                                                                |
| `ChildRef`                    | One child of a block: `{ id, type, index }`.                                                                                                                          |
| `BlockActions`                | Structural actions of one block (`add`/`remove`/`duplicate`/`moveUp`/`moveDown`/`moveTo`).                                                                            |
| `EditorOutlineItemProps`      | Props of `Editor.OutlineItem`: `blockId`, `onDelete?`, `render?`, div props.                                                                                          |
| `EditorLiveAnnouncerProps`    | Props of `Editor.LiveAnnouncer`: div props.                                                                                                                           |
| `EditorOutlineProps`          | Props of `Editor.Outline`: `indent?`, div props.                                                                                                                      |
| `EditorShortcutHelpProps`     | Props of `Editor.ShortcutHelp`.                                                                                                                                       |
| `ShortcutEntry`               | `{ id, label, keys }` of `useShortcutList`.                                                                                                                           |
| `RovingFocus`                 | What `useRovingFocus` returns.                                                                                                                                        |
| `RovingFocusOptions`          | `{ orientation?, loop?, dir? }` of `useRovingFocus`.                                                                                                                  |
| `EditorErrorSummaryProps`     | Props of `Editor.ErrorSummary`.                                                                                                                                       |
| `ErrorSummaryEntry`           | `{ id, label, blockId, field }` of `useSaveIssues`.                                                                                                                   |
| `SectionOverrideEntry`        | `{ nodeId, key, field, blockLabel, value, overridden, set }` of `useSectionOverrides`.                                                                                |
| `EditorAddBlockProps`         | Props of `Editor.AddBlock`: `type`, `parentId?`, `slot?`, `index?`, `render?`, button props.                                                                          |
| `EditorOutlineGroupProps`     | Props of `Editor.OutlineGroup`: `blockId`, `slot`, `render?`, div props.                                                                                              |
| `InsertPoint`                 | `insertPointFor`'s result: `{ parent: SlotRef, index, allowed }`.                                                                                                     |
| `OutlineGroupState`           | `useRender` state of `Editor.OutlineGroup` (`{ slot, blockId }`).                                                                                                     |
| `OutlineItemState`            | `useRender` state of `Editor.OutlineItem`.                                                                                                                            |
| `AddBlockState`               | `useRender` state of `Editor.AddBlock` (`{ blockType }`).                                                                                                             |
| `NestedFieldControlProps`     | What a nested field of an `object` receives (`spec`, `fieldKey`, `value`, ...).                                                                                       |
| `NestedFieldRender`           | `(props: NestedFieldControlProps) => ReactElement \| null`, passed to `object` controls.                                                                              |
| `EditorMoveToDialogProps`     | Props of `Editor.MoveToDialog`.                                                                                                                                       |
| `MoveToTarget`                | `{ parent, label, depth, count }` of `useMoveTargets`.                                                                                                                |

## Data attributes

| Attribute           | On                                                       | Meaning                                                                                                          |
| ------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `data-kind`         | `Editor.Field`, `Editor.FramePreview`                    | On Field: the property kind (`spec.type`). On FramePreview: `html` or `blob` after the first successful display. |
| `data-required`     | `Editor.Field`, `Editor.FieldLabel`                      | Present when the spec is `required`.                                                                             |
| `data-invalid`      | `Editor.Field`, `Editor.FieldLabel`, `Editor.FieldError` | Present while `validateField` reports at least one finding.                                                      |
| `data-disabled`     | `Editor.Field`, `Editor.FieldLabel`                      | Present when the field is `disabled`.                                                                            |
| `data-focused`      | `Editor.Field`                                           | Present while the store's focused field (local user) is this one.                                                |
| `data-stale`        | `Editor.Preview`, `Editor.FramePreview`                  | Present while a store version change is pending display.                                                         |
| `data-loading`      | `Editor.FramePreview`                                    | Present while a compile for the current version is in flight.                                                    |
| `data-error`        | `Editor.FramePreview`                                    | Present when the latest non-aborted compile failed.                                                              |
| `data-block-type`   | `Editor.Form`, `Editor.OutlineItem`, `Editor.AddBlock`   | The block type (`root` on a form for the root; the palette type on `AddBlock`).                                  |
| `data-block-id`     | `Editor.Form`, `Editor.OutlineItem`                      | The block this form or row represents.                                                                           |
| `data-group`        | `fieldset` inside `Editor.Form`                          | The group label of the fields inside.                                                                            |
| `data-selected`     | `Editor.OutlineItem`                                     | Present while this row is the local user's selected block.                                                       |
| `data-depth`        | `Editor.OutlineItem`                                     | Hops from the root (root children are `1`).                                                                      |
| `data-has-children` | `Editor.OutlineItem`                                     | Present when the block has at least one child.                                                                   |
| `data-expanded`     | `Editor.OutlineItem`                                     | Present while the row has children and is not collapsed.                                                         |
| `data-hovered`      | `Editor.OutlineItem`                                     | Present while the pointer is over this block (here, in the canvas or a preview).                                 |

## Tests

| File                                     | Covers                                                                                                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `editor.test.tsx`                        | Root provides context, store and user; parts outside Root throw; namespace keys; Canvas.Overlay throw; Canvas DnD namespace keys.                                                                      |
| `editor.browser.test.tsx`                | Chromium mount + click on `Editor.Root`.                                                                                                                                                               |
| `canvas/canvas.browser.test.tsx`         | Chromium canvas host box, anchor rects, layout wait, pointer coordinates, ring vs block gBCR (1 px), resize, scroll without remeasure, nested field key, same-id union.                                |
| `canvas/dnd.test.ts`                     | Pure DnD helpers: `adjustMoveIndex`, `blockIdAtPoint`, store threshold, session vs target subscriptions.                                                                                               |
| `canvas/dnd-parts.test.tsx`              | DragHandle / PaletteItem / DropIndicator / DragPreview throw outside Root; preview uses translate3d during drag; palette click insert; drag threshold; escape cancel.                                  |
| `canvas/dnd.browser.test.tsx`            | Chromium palette drop, sibling moves, escape cancel, auto-scroll, touch drag, forbidden placement, focus after drop, select mode without drag.                                                         |
| `canvas/inline-text.test.ts`             | Pure inline helpers: `applyTextEdit`, placeholder injection, field kind.                                                                                                                               |
| `canvas/inline-parts.test.tsx`           | InlineText throw outside Root; string vs number activation; nested key; richText click without session; two editors; empty badge commit.                                                               |
| `canvas/inline-text.browser.test.tsx`    | Chromium inline glass activation, caret, typing, Enter/Escape, discardOnEscape, nested key, richText click keeps HTML, empty badge, suggest keyboard, two canvases, number field, undo during session. |
| `canvas/insert.test.ts`                  | Pure `resolveInsertAt` with stubbed rects (column, row, grid, empty box, walk-up, dragged id, nearest ancestor).                                                                                       |
| `canvas/toolbar.test.tsx`                | BlockToolbar / InsertButton throws, selection gating, overlay chrome hover guard.                                                                                                                      |
| `canvas/insert.browser.test.tsx`         | Chromium column / row / grid insert, empty box, toolbar placement, disabled gating, select mode toolbar without insert.                                                                                |
| `canvas/rect.test.ts`                    | `unionRects`, readonly skip, nested field key own-block lookup.                                                                                                                                        |
| `canvas/overlay.test.tsx`                | Overlay portal into host, `useBlockRect` callable, SelectionRing / FieldRing presence, HoverRing suppression.                                                                                          |
| `canvas/renderer.test.tsx`               | Store-tree walk, edit anchors, resolve cache, unresolved omit, referenced readonly, intercept, Hero snapshot.                                                                                          |
| `keyboard.test.tsx`                      | `useEditorKeyboard`: undo/redo (including inside inputs), `preventDefault`, optional Delete/Escape, throw outside Root.                                                                                |
| `editor-ssr.test.tsx`                    | `renderToString` then `hydrateRoot` of `Editor.Root` + `Editor.Form`; no hydration mismatch.                                                                                                           |
| `binding.test.tsx`                       | `shallowEqual`; channel selectors (re-render and memoisation per scope); prop-closure recomputation.                                                                                                   |
| `hooks.test.tsx`                         | Every untyped hook including `useChildren` child refs and `useBlockActions`, Root callbacks, `key`-based reset, `scrollTo`.                                                                            |
| `factory.test.tsx`                       | `createEditor`'s runtime shape (incl. `useBlockActions`, `useEditorKeyboard`, `Preview`, `FramePreview`), typed narrowing at runtime, the schema guard, nested factories.                              |
| `factory.type-check.ts`                  | Compile-time: the derived types (`DocumentOf`, `BlockHandleOf`, `ChildRefOf`, `TypedBlockActions`, factory `Preview`/`FramePreview` tree arg, `scrollTo`) against a representative schema.             |
| `field/field.test.tsx`                   | Built-in controls, control resolution (render/map/default, warn-once), label/description/error wiring, focus sync, coalesced typing, `Editor.Form` grouping and `autoScroll`, `useMissingRequired`.    |
| `field/field.type-check.ts`              | Compile-time: per-kind `FieldControlProps`, the `FieldControls` map, `fields` on Root and context.                                                                                                     |
| `preview/preview.test.tsx`               | Debounced raw-tree updates, collapse of rapid ops, no update on focus, throw outside Root, Field/store focus roundtrip, invoice form + PDFViewer placeholder.                                          |
| `preview/frame-sandbox.test.ts`          | Sandbox token default, `selectable` `allow-same-origin`, forbidden tokens stripped, no duplicate `allow-same-origin`.                                                                                  |
| `preview/frame-issues.test.ts`           | Relative `src`/`href`, absolute forms, missing `href`, one `preview-anchors` finding.                                                                                                                  |
| `preview/frame-anchor.test.ts`           | Field inside its block, nested block does not steal the outer id, `resolveAnchor` win and fallthrough.                                                                                                 |
| `preview/frame-preview.browser.test.tsx` | Chromium: double buffer, sequence race, selectable click, reverse `data-editor-focused`, blob revoke, sandbox attributes, stacked form + FramePreview, invoice Blob.                                   |
| `structure/structure.test.tsx`           | `Editor.OutlineItem` keyboard/aria/selection, `Editor.AddBlock` insert-point rule, stacked-form acceptance.                                                                                            |
| `structure/structure.type-check.ts`      | Compile-time: `onDelete` return, required `type` on `AddBlock`, factory `useChildren`/`TypedBlockActions`.                                                                                             |

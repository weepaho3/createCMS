# Editor device and browser runbook

The automated suites run in headless Chromium, Firefox and WebKit on a
desktop. Touch, on-screen keyboards, IME, screen readers and real Safari
on iOS behave differently and need a person with the device. Run this
runbook before a release that touches `/editor`, `/editor/canvas` or the
registry shell, and record every row in the results table at the end.

## Setup

- Start the docs app: `bun run dev` in `apps/docs` (port 4000), or use the
  preview deployment of the branch.
- Demos:
  - `/demo/editor/app`: `editor-app` on the memory adapter (no backend).
  - `/demo/editor/pages`: the createCMS demo with the frame canvas.
  - `/demo/editor/form`: form only.
- On a phone or tablet, open the LAN address of the dev server (or the
  preview URL). Keep the browser at 100% zoom.
- Note the exact OS and browser versions in the results table.

Each scenario lists what to do and what must happen. A row passes only if
every expected point holds; otherwise record what happened and open an
issue in the editor project.

## Scenarios

### 1. Pointer capture across the frame boundary

Browsers: Firefox (current), Safari (current macOS), Chrome.
Demo: `/demo/editor/pages`.

1. Drag a block by its handle from inside the canvas frame onto the
   outline in the left sidebar, and back.
2. Start a drag in the palette (left) and drop it into the canvas frame.
3. During a drag, leave the browser window and come back, then release.
4. Drag fast across the frame edge several times.
5. Start a drag and press Escape over the frame.

Expected: the drop indicator follows the pointer on both sides of the
boundary; a release outside a valid target cancels without a change;
Escape cancels; no block stays in a dragging state.

### 2. Touch drag with implicit capture and long press

Devices: iOS 26 and 27 (Safari and an in-app WKWebView), Android Chrome,
Samsung Internet. Demo: `/demo/editor/app` (tablet width) and
`/demo/editor/pages`.

1. Long-press a drag handle for about 250 ms without moving more than
   5 px, then drag a block into another slot.
2. Move a finger quickly over a handle without holding: the page scrolls,
   no drag starts.
3. Drag from the canvas frame onto the outline and back.

Expected: a drag starts only after the long press; scrolling still works;
the drop lands where the indicator showed.

### 3. Long press against native selection and callout

Devices: iOS 26.1 and later. Demo: `/demo/editor/app`.

1. Long-press a drag handle and a block toolbar button.
2. Long-press inside text of a block that is not being edited.

Expected: no text selection loupe or callout menu on handles and toolbar
buttons (`-webkit-touch-callout: none`); text in content stays selectable.

### 4. Bottom sheet and keyboard

Devices: iOS 26 and 27 Safari, Android Chrome. Demo: `/demo/editor/app`
at phone width.

1. Select a block; the properties sheet opens. Focus a text field.
2. Type, then dismiss the keyboard; rotate the device; focus again.
3. Snap the sheet between its three heights while the keyboard is open.
4. Use the back gesture with a sheet open.

Expected: the focused field stays visible above the keyboard; the bottom
bar never ends up behind the keyboard or floating mid-screen after it
closes (`visualViewport` `offsetTop` reset); the back gesture closes the
sheet and stays on the page.

### 5. Keyboard in a frame `contenteditable`

Device: iOS Safari. Demo: `/demo/editor/pages`.

1. Tap a heading in the canvas frame to edit it in place.
2. Select a block from the outline (no tap in the frame), then use the
   keyboard shortcut that starts inline editing.

Expected: a tap opens the keyboard; starting edit mode without a user
gesture does not open it (iOS rule) and the field shows it is editable.

### 6. IME composition

Keyboards: Gboard and Samsung Keyboard (Japanese, Chinese), iOS Japanese
and Chinese, macOS Japanese. Demo: `/demo/editor/app` (rich text
paragraph) and a text field in the inspector.

1. Compose text, confirm a candidate with Enter.
2. Backspace across a link and across a mark boundary.

Expected: Enter confirms the candidate and does not split the block or
submit; no doubled or lost characters; undo restores the state before
the composition as one step.

### 7. `plaintext-only` fields

Browsers: Firefox, Safari, Chrome. Demo: `/demo/editor/pages` (inline
heading text).

1. Press Enter at the end of a heading.
2. Paste formatted text from another page.
3. Leave the field with a trailing space and a trailing line break.

Expected: Enter ends editing instead of inserting a line; paste inserts
plain text; the stored value has no stray `<br>` or trailing newline.

### 8. Safari focus while dragging

Browser: Safari (macOS). Demo: `/demo/editor/pages`.

1. Start editing a heading inline, then drag another block by its handle.

Expected: editing ends cleanly before the drag; no caret remains in the
old field; the dragged block lands correctly (WebKit bug 112854).

### 9. Screen readers

Readers: VoiceOver (macOS, iOS), NVDA and JAWS (Windows), TalkBack
(Android). Demo: `/demo/editor/app`.

1. Outline: move through the tree with arrows; expand and collapse.
2. Block toolbar: reach it with Alt+F10, move with arrows, leave with
   Escape.
3. Keyboard move: pick up a block with the handle (Space), move it with
   arrows, drop it; listen to the announcements.
4. Open the handle as a menu (Move to, Wrap, Copy) and use Move to.
5. Save with an empty required field; follow the error summary links.

Expected: every element has a name and role; level, position and
expanded state are read in the tree; moves and drops are announced; focus
returns where it started after Escape.

### 10. Style mirroring into the frame

Browsers: Chrome, Firefox, Safari. Setup: a page that uses a CSS-in-JS
library, a cross-origin stylesheet and a strict CSP.

Expected: canvas blocks look like the published page; cross-origin rules
the browser hides are reported in the console as a single editor warning,
not as errors.

### 11. Overlay positioning

Browsers: Chrome, Firefox, Safari. Demo: `/demo/editor/pages`, with test
blocks using `transform`, `zoom`, sticky and fixed positioning,
`display: contents`, and a web font that loads late.

Expected: selection and hover rings and the toolbar match the block
outline after scrolling, resizing and font loading.

### 12. Label anchoring and flip

Browsers: Safari 26.x before 26.2, Safari 27, Firefox 147 and later.
Demo: `/demo/editor/pages`.

1. Select the first block at the very top of the frame and blocks near the
   right edge.

Expected: the block label and toolbar stay inside the frame and flip
below or inward when there is no room above.

### 13. Clipboard across tabs, windows and browsers

Browsers: Chrome, Firefox, Safari. Demo: `/demo/editor/app` in two tabs
and in two browsers.

1. Copy a block with Mod+C in one tab, paste with Mod+V in the other.
2. Copy plain text from another app and paste into a selected block.

Expected: blocks paste with fresh ids and their content; plain text
pastes as a text block; nothing pastes into the wrong slot.

### 14. Performance with 1000 blocks

Devices: a mid-range Android phone, an older iPad, a desktop. Page: the
1000-block fixture from `src/editor/perf.browser.test.tsx` mounted in a
demo route, or a document with 1000 blocks in `/demo/editor/app`.

Expected: typing in a field shows no visible lag; a drag across the page
stays smooth; scrolling the outline does not stutter.

## Screen reader check per release

Before every release with editor changes, run scenario 9 with VoiceOver
on macOS and NVDA on Windows at least; the full reader matrix for minor
releases.

## Results

Copy the table for each run. Result: pass, fail (with issue link) or
not run (with reason).

| #   | Scenario                             | Device, OS | Browser / reader, version | Result | Notes |
| --- | ------------------------------------ | ---------- | ------------------------- | ------ | ----- |
| 1   | Pointer capture across the frame     |            |                           |        |       |
| 2   | Touch drag and long press            |            |                           |        |       |
| 3   | Long press vs. selection and callout |            |                           |        |       |
| 4   | Bottom sheet and keyboard            |            |                           |        |       |
| 5   | Keyboard in frame contenteditable    |            |                           |        |       |
| 6   | IME composition                      |            |                           |        |       |
| 7   | `plaintext-only` fields              |            |                           |        |       |
| 8   | Safari focus while dragging          |            |                           |        |       |
| 9   | Screen readers                       |            |                           |        |       |
| 10  | Style mirroring                      |            |                           |        |       |
| 11  | Overlay positioning                  |            |                           |        |       |
| 12  | Label anchoring and flip             |            |                           |        |       |
| 13  | Clipboard                            |            |                           |        |       |
| 14  | Performance with 1000 blocks         |            |                           |        |       |

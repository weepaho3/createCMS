# Canvas (`@createcms/react/editor/canvas`)

Headless editor primitive — live surface, overlay and interaction layer.
Unstyled; styling happens in the consumer's wrapper components (registry).

## Usage

(TODO)

## Parts

| Part          | Default element | Props        | Data attributes      |
| ------------- | --------------- | ------------ | -------------------- |
| `Canvas.Root` | `div`           | …`div` props | `data-editor-canvas` |

## Hooks

| Hook               | Returns | Notes |
| ------------------ | ------- | ----- |
| (TODO — none yet.) |         |       |

## Types

| Type              | Description             |
| ----------------- | ----------------------- |
| `CanvasRootProps` | Props of `Canvas.Root`. |

## Data attributes

(TODO — none yet, beyond the presence marker `data-editor-canvas`.)

## Tests

happy-dom (`editor.test.tsx`) covers context sharing and the throw
outside `Editor.Root`. Chromium (`canvas.browser.test.tsx`) covers
layout, pointer coordinates and anything that needs
`getBoundingClientRect` / `ResizeObserver`. Unit tests never assert
rects. Browser tests never screenshot; they assert rects and DOM.
Helpers: `test/harness.tsx` and `test/fixtures.tsx` (not test files).

| File                      | Covers                                                                     |
| ------------------------- | -------------------------------------------------------------------------- |
| `editor.test.tsx`         | Canvas.Root shares context with Editor.Root; throws outside it.            |
| `canvas.browser.test.tsx` | Chromium: host box, heading anchor rect, layout wait, pointer coordinates. |

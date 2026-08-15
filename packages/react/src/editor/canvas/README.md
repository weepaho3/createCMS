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

| File              | Covers                                                          |
| ----------------- | --------------------------------------------------------------- |
| `editor.test.tsx` | Canvas.Root shares context with Editor.Root; throws outside it. |

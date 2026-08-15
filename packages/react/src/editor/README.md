# Editor (`@createcms/react/editor`)

Headless editor primitive — schema, state, form and preview layer. Unstyled;
styling happens in the consumer's wrapper components (registry).

## Usage

(TODO — arrives with the state layer.)

## Parts

| Part          | Default element | Props                           | Data attributes |
| ------------- | --------------- | ------------------------------- | --------------- |
| `Editor.Root` | none (provider) | `schema` (required), `children` | —               |

## Hooks

| Hook               | Returns              | Notes                                                                              |
| ------------------ | -------------------- | ---------------------------------------------------------------------------------- |
| `useEditorContext` | `EditorContextValue` | Throws when used outside `Editor.Root`. Internal-facing; typed hooks arrive later. |

## Types

| Type                 | Description                               |
| -------------------- | ----------------------------------------- |
| `EditorRootProps`    | Props of `Editor.Root`.                   |
| `EditorContextValue` | What `Editor.Root` shares with its parts. |

## Data attributes

(TODO — none yet.)

## Tests

| File              | Covers                                           |
| ----------------- | ------------------------------------------------ |
| `editor.test.tsx` | Root provides context; parts outside Root throw. |

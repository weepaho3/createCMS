---
'@createcms/react': patch
---

A11y contract for `@createcms/react/editor`: `useEditorKeyboard(scopeRef)`
binds undo/redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y) and optionally
Delete/Escape; built-in controls set `aria-required` when the spec is
required; README tables for keyboard, ARIA and focus; SSR hydration test
for `Editor.Root` + `Editor.Form`.

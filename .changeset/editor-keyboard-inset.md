---
'@createcms/react': patch
---

`useKeyboardInset()` in `@createcms/react/editor` returns the height the
on-screen keyboard covers at the bottom of the viewport, so bottom bars and
sheets can stay above it.

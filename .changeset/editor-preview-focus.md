---
'@createcms/react': patch
---

`Editor.Preview` renders a delayed raw store tree; `Editor.Form autoScroll`
scrolls the focused block into view; `useEditor().scrollTo` scrolls a
registered form or a `[data-block-id]` inside an optional container.

---
'@createcms/react': patch
---

`Editor.FramePreview` shows compiled HTML or Blob output in a double-buffered
sandboxed iframe, with selectable anchors, stale-response discarding, and
`onIssues` for relative URLs, missing hrefs and leftover editor anchors.

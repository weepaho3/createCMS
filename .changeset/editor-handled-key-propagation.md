---
'@createcms/react': patch
---

A key the editor's keyboard binding handled no longer propagates past the
document, so an app-wide `window` hotkey on the same combo (a site search on
Mod+K) does not open alongside the editor's command palette.

---
'@createcms/react': patch
---

`Editor.Slot` renders its own `children` before the plugin contributions,
so an outlet can carry built-in content that plugins extend.

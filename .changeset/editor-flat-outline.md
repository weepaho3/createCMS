---
'@createcms/react': patch
---

Outlines can be virtualized: `useFlatOutline` returns the visible rows in
document order with level, position and set size, and `Editor.Outline`
takes the block ids as `rows` plus a `reveal` callback, so arrow keys,
Home, End, type-ahead and Delete reach rows that are not mounted.

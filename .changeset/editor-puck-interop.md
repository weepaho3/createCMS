---
'@createcms/react': patch
---

`fromPuckData` and `toPuckData` in `@createcms/react/editor/core` convert
between Puck's `Data` and an editor document: props named like a declared
slot and legacy `zones` become slots, and ids are minted fresh unless
`keepIds` is set.

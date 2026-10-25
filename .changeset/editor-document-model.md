---
'@createcms/react': patch
---

`@createcms/react/editor/core` exports the document model types (`NodeData`,
`FlatNode`, `EditorDocument`, `NormalizedDoc`, `SlotRef`, `Op`, `Origin`,
`JsonValue`) and `canonicalJson`, which serialises a JSON value with sorted
keys and without `undefined` members.

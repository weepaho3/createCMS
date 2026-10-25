---
'@createcms/react': minor
---

The editor store, placement and handles work on named slots. Nodes sit at
`parent: { id, slot }` and hold `slots`; `store.add` and `store.move` take a
`{ parent: { id, slot? } }` target, and `canPlaceIn` replaces
`getPlacement`/`canPlace` with per-slot results (`unknown-slot`,
`self-nesting`, `not-allowed`, `slot-full`, honouring `max`). `remapIds`
copies a subtree with fresh ids and rewrites anchor links and custom
`rewriteRefs` fields to the copy; `duplicate` uses it. Slot `defaultValue`s
seed new blocks. New: `useSlot`, `useSlots`, `Editor.OutlineGroup`,
`insertPointFor`, `Editor.AddBlock`'s `slot` prop, and canvas insert
geometry per slot element (`getSlotRect`). Block handles expose `props`,
`parent`, `slots` and `setProps`.

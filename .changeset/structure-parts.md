---
'@createcms/react': minor
---

Structure parts for `@createcms/react/editor`: `Editor.OutlineItem` (tree row
with selection, arrow navigation, Alt+arrow reorder, Delete with an `onDelete`
veto and focus return, Escape), `Editor.AddBlock` (inserts a palette type at
the selection point and selects it), `useBlockActions(id)` (placement-gated
add/remove/duplicate/moveUp/moveDown with `canMoveUp`, `canMoveDown`,
`canHaveChildren`, `allowedChildTypes`), typed in the factory as
`TypedBlockActions`.

BREAKING: `useChildren(parentId)` returns child refs `{ id, type, index }`
instead of a string array (the factory narrows `type` to the schema's block
types). Read `child.id` where an id was used before.

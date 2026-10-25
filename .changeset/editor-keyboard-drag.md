---
'@createcms/react': patch
---

Every block move works without dragging. `Canvas.DragHandle` opens a menu
on click or Enter (move up, move down, move to, duplicate, delete) and
starts a keyboard drag on Space that steps through every valid place in
document order with announcements; `Editor.MoveToDialog`,
`useMoveTargets` and `useBlockActions().moveTo` move a block to any slot.
Files dropped from the desktop become blocks through `Canvas.Root`'s
`fileDrop`, and empty slots keep a minimum height in the registry styles.

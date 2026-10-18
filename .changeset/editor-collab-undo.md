---
'@createcms/react': patch
---

The Yjs store undoes with `Y.UndoManager`: an undo reverts only this
store's own changes and only what the step changed, so another person's
edits are never undone. Steps, merging, marks, selection and labels follow
the same rules as the JSON store. `createDocStoreCore` takes
`recordHistory: false` for backends with their own history.

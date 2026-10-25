---
'@createcms/react': minor
---

The editor store runs every document write through a command pipeline and
keeps its state in three scopes. `dispatch`, `transact`, `use` (middleware
with priorities, placement innermost) and `handle` (command handlers) replace
direct mutations; `add`/`update`/`move`/`remove`/`duplicate`/`wrap` are thin
command creators. Document, session (selection, focus, history, save) and
ephemeral (hover) state notify on separate channels (`useDocSelector`,
`useSessionSelector`, `useEphemeralSelector`, `useHovered`), so hover never
re-renders document readers.

History merges typing runs by `mergeKey` (400 ms, sliding), restores the
selection on undo and redo, caps at 200 steps, supports `mark`/`squash`/`bail`
for live writes, and drops steps a remote change conflicts with instead of
failing silently. `DocStore` and `createJsonDocStore` define the document
store the editor writes through; `Editor.Root` accepts an injected `store`.

Saving goes through `persistence: { save(doc, { ops, baseVersion, force,
message }), baseVersion, autosave }` with debounce, max wait, one save in
flight, network retries with backoff and a conflict state
(`useSaveConflict`: reload, overwrite, copy mine). `mergeByNode` merges three
documents per node. `defineEditorPlugin` adds field kinds, blocks, UI
commands, shortcuts, event handlers and `Editor.Slot` outlets
(`useCommand`, `useCommands`). `useCmsDocument` returns `persistence`, and
the createcms adapter attaches the server document to a conflict.

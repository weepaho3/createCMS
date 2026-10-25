---
'@createcms/react': minor
---

The editor speaks every language: all built-in texts come from a message
catalog (`messages` on `Editor.Root`, plugin `messages`, `EN_MESSAGES`), with
`formatIssue` for validation findings, platform-aware shortcut labels and
`dir` for right-to-left editors. `Editor.LiveAnnouncer` announces inserts,
moves, removals, undo and redo, editing and refused edits.

Inline text follows plain-text rules (line breaks, `maxLength`, paste, IME
composition) in the glass and in `useEditableField`, which edits a
component's own element in place for text the glass cannot copy.

Keyboard and screen reader support: a full shortcut set as commands
(selection, structure, clipboard, `ui.*`) routed from the host page and
preview frames, `Editor.ShortcutHelp`, a roving-tabindex block toolbar with
Alt+F10, an APG outline tree (`Editor.Outline`, collapse state, type-ahead,
set size and position) and click-to-field focus.

The canvas selects ranges (Shift), toggles (Mod) and parents (Alt), uses a
select-first tap model on touch and offers `Canvas.ContextMenu`. Blocks copy,
cut and paste across tabs through `text/html` with an embedded payload, with
schema and placement checks on paste.

Saves pass `beforeSave` gates (`requireValidDocument`) and carry a phase;
`Editor.ErrorSummary` lists what blocked a save. Reusable sections are `$ref`
nodes resolved through `createSectionResolver` with a depth limit, exposed
prop overrides and a detach command.

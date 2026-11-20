---
'@createcms/react': minor
---

`RichTextCommands.getLink()` returns the link at the selection (its
`LinkValue`, `{ kind: 'href' }` for a bare URL, or `null`), so a link
editor can show and change the current target. It is optional for custom
adapters.

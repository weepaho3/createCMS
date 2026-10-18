---
'@createcms/react': patch
---

Collaborative rich text: the Yjs doc store keeps rich text props in `Y.XmlFragment`s in the encoding of Tiptap's Collaboration extension, and `createTiptapAdapter({ collaboration })` binds fields to them, so several people can type in one field at once. New in core: `RichTextBinding`, `DocStore.getText`, `store.getTextBinding`, `normalizeRichTextJson` and `diffOps`; in `/editor`: `useTextBinding`. The editor store now emits `change` (and autosaves) for changes a doc store receives on its own, such as edits from other peers.

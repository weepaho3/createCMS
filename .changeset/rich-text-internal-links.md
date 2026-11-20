---
'@createcms/react': patch
---

Internal links in rich text (`{ kind: 'internal', collection, rootId }`)
no longer throw in the Tiptap editor: a link without a browser URL passes
the link check, and `setLink` stores its target.

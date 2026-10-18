---
'@createcms/core': patch
---

The usage index reads rich text documents. A `richText` value stored as
ProseMirror JSON (an object, or the same document as a string) gives its
image nodes as asset usages with alt state and revision pin, its internal
link marks as links, and the asset URLs in its text and external links;
paths point at the node. `replaceAssetUsages` rewrites `attrs.assetId` of
image nodes and internal link marks. Rich text stored as HTML is read as
text, as before, and `guardRichTextReferences` stays on until stored
documents are migrated.

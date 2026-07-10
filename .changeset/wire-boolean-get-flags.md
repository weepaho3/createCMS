---
'@createcms/core': patch
---

fix(routes): decode remaining GET boolean query flags wire-safely

`z.coerce.boolean()` turns the wire string `'false'` into `true`
(`Boolean('false') === true`), so passing `false` over HTTP inverted the flag.
Migrated the last GET flags — `listBranches` (isDeletable / hasPublications /
hasOpenMergeRequests), `listRoots` (hasPublications), `notifications.list`
(unreadOnly), `getBlockTree` (raw / includeReferencePreviews),
`getPublishedContent` (raw), and `listAssets` (unfiled) / the media asset gate
(download) — to `wireBooleanSchema` + `wireBooleanIsTrue`. Tri-state filters keep
true/false/absent distinct. In-process callers passing real booleans are
unaffected.

---
"@createcms/core": patch
---

Versioned slug (cms-05). The root `slug` is now part of the versioned content
(isolated per branch) and is materialized to the live URL only on publish, so a
draft-branch slug edit no longer changes the live URL immediately, and
`revertBranch` restores the slug along with the content.

Behavior changes:

- **A draft slug edit is isolated until publish.** `updateRoot` now commits the
  slug to the branch (stored on the root block version) instead of writing the
  global `roots.slug`. The live URL only changes when the default/identity branch
  is published. `createRoot` leaves the entry's live slug unset until its first
  publish.
- **Uniqueness is enforced at publish, not at draft-write.** Draft branches may
  hold colliding slugs; publishing a colliding slug throws the new typed
  `PUBLISH_SLUG_CONFLICT` (an atomic `publishRelease` rolls the whole release
  back on conflict). The cheap empty/format check stays at write time.
- **Slug-change redirects are created at publish**, not at the draft edit, so a
  never-published slug edit creates no redirect.
- `revertBranch` (and merge/history) now carry the slug, since it is versioned
  content; two branches editing the slug produce a normal root-block merge
  conflict instead of a silent overwrite.
- `parentRootId` / `moveRoot` are unchanged (a page move still changes the live
  URL immediately); only the slug is versioned.

No schema migration is required (the draft slug rides an existing JSONB column).
A `backfillDraftSlugs` script copies each existing entry's current live slug into
its draft content so existing pages have a draft slug to edit and re-publish.

Known limitations (documented): clearing a slug to make an `allowRoot` page the
home page is not re-materialized on republish; and publish-time slug uniqueness
is scoped to the active request scope, so publish i18n translations within their
own language context.

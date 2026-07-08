---
"@createcms/core": patch
---

Integration-DX pass (toe-int-02 … 15). Fills the gaps consumers had to work
around when building on the API.

- **User discovery endpoints** (toe-int-06/05): `users.listReviewers` returns
  candidate reviewers as `{ id, ...exposeColumns }` (so an approval UI can build a
  reviewer picker), and `users.whoami` returns `{ userId, user }`. Both are
  permission-gated (`user` resource) and only ever expose the configured
  `user.exposeColumns` (never password hashes/tokens).
- **Branch-by-name lookup** (toe-int-02): `getBranch` now accepts
  `{ rootId, name }` as well as `{ branchId }`, so named-branch URLs no longer
  page through `listBranches` + `.find` (which broke past 100 branches).
- **Root-level asset listing + bulk resolve + cursor paging** (toe-int-03/15):
  `listAssets({ unfiled: true })` lists assets with no folder (wire-safe boolean,
  replacing the un-serializable `folderId: null`); new `getAssets({ ids })` bulk
  resolves assets by id (single id works over HTTP); and `listAssets` gained
  precision-exact cursor pagination so a media library can page past the 100-item
  ceiling without skipping or duplicating rows.
- **Uploads auto-optimize** (toe-int-04): when the media-optimize client plugin is
  installed, `useUploadAssets` optimizes images by default (opt out per call with
  `optimize: false`); previously the registered config was never read.
- **Notifications without wiring your auth client** (toe-int-05/08):
  `useNotifications` resolves the current user via `users.whoami` when `userId` is
  omitted, and nesting `RealtimeProvider` now shares the single SSE connection
  (with a dev warning) instead of silently opening a second stream.
- **Consistent revalidation paths** (toe-int-14): `RevalidateEvent`'s bare `slug`
  is renamed `storedSlug` and every URL-shaped value in `paths` is a leading-slash
  path, so using an event value as a Next.js cache tag no longer silently fails to
  bust. Consumers reading `event.slug` should read `event.paths` (for tags) or
  `event.storedSlug` (the bare slug).
- **Docs** (toe-int-09): route-mount snippets now show
  `export const dynamic = 'force-dynamic'` for the realtime SSE stream.

---
'@createcms/core': minor
---

fix(media): add a browser-callable asset replace flow and stop leaking S3 objects on replace

**Migration note (browser callers of `replaceAsset` only):** `replaceAsset`
takes an in-process `buffer: Blob | ArrayBuffer` and always required a
server-side caller — a `File` selected in the browser cannot survive the
client's JSON request body (it serializes to `{}`), so a browser call
type-checked but failed at runtime. `replaceAsset` itself is unchanged and
remains available for server-side callers; browser callers must migrate to
the new signed flow: `createSignedReplace` (mint a slot + signed PUT URL) then
`commitReplace` (repoint the row) once the client's PUT to S3 succeeds. The
React client wraps this as `client.media.useReplaceAsset()` (mirrors
`useUploadAssets`); the vanilla client exposes the same state as a raw
nanostores atom at `client.media.replaceState`.

Two more media fixes bundled with the above:

- **Replacing an asset no longer leaks its superseded S3 object.** `replaceAsset`
  (and now `commitReplace`) minted a new object and repointed the row, but
  nothing ever named the old object again, so the pruning pass's reclaim query
  — which only deletes objects read off an _archived asset row_ — could never
  find it. Both endpoints now also insert a tombstone: a fresh, immediately
  archived asset row that reuses the superseded slug/object key (with a new
  id, so it isn't held alive by the original's content references), which the
  existing pruning pass picks up and deletes once the trash window elapses.
  The same treatment covers the TOCTOU rollback path, which used to abandon
  the just-uploaded object outright.
- **Upload/replace failures no longer return the raw S3 provider error to
  clients.** `uploadAssets` and `replaceAsset` used to put the S3 error
  message on `data.cause`, which reaches the wire. The full detail is still
  logged server-side (`console.error`); only the client-facing error is
  trimmed to a status code.

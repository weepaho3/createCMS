---
'@createcms/core': minor
---

feat(types): hide server-only endpoints from the client's type surface

`media.uploadAssets` and `media.replaceAsset` no longer appear in
`cmsClient`'s / `client`'s inferred types. Both take an in-process
`buffer: Blob | ArrayBuffer` body that can't survive the client's JSON
request — a `File` selected in the browser serializes to `{}` over the wire
— so a browser call used to type-check and fail only at runtime. They're now
marked `scope: 'server'` in their endpoint metadata, and the client's type
builder omits any endpoint carrying that mark: `client.media.uploadAssets`
and `client.media.replaceAsset` are now compile errors, not just runtime
ones. Their browser-callable counterparts are unaffected and unchanged —
`createSignedUpload` for uploads, `createSignedReplace` + `commitReplace` (or
the `useReplaceAsset` client hook) for replaces.

**This is a type-level guard only — no runtime behavior changed.** The
client's request proxy still dispatches any method name it's given, so a
caller that bypasses the type system (`as any`, plain `fetch`, etc.) reaches
the same server route and fails the same way it always did. A runtime guard
on the client proxy is a separate, not-yet-made decision.

`cms.api.media.uploadAssets` and `cms.api.media.replaceAsset` — the
server-side API used by in-process callers — are completely unchanged: same
signatures, same behavior, still fully callable. Only the client's inferred
type surface shrank.

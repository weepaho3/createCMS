---
"@createcms/core": patch
---

Fix the public media gate `GET /media/asset/{slug}`, which 404'd then 200'd on every real request (so images served through it never loaded).

- **Route param syntax.** The route was registered with OpenAPI-style braces (`/media/asset/{assetSlug}`), but better-call passes the path verbatim to rou3, which only matches `:param` — so a real `/media/asset/<slug>` request never matched and 404'd at the router before the handler ran. Registered as `/media/asset/:assetSlug` (handler unchanged; it still reads `ctx.params.assetSlug`).
- **Redirect status + headers.** The handler set the redirect via a returned `{ headers, body }` object, but better-call applies response headers/status from `ctx.responseHeaders`/`ctx.redirect` — the returned object is only visible to the server-side caller. Over real HTTP the router answered `200` with an empty body (a broken image). It now issues a proper `302` to the public object URL via `ctx.redirect()`, with immutable `cache-control` and, for `?download`, `content-disposition`.

Both paths were masked because the existing tests called the server-side `cms.api.media.asset(...)` caller, which bypasses URL routing; the gate is now covered by tests that drive a real `Request` through `cms.router.handler`.

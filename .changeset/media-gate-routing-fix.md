---
"@createcms/core": patch
---

Media gate is now addressed by the **asset id**, and content images are served with no read-path resolution.

- **Gate by id.** The public gate is `GET /media/asset/{id}` (the stable asset id, which is exactly what content stores), a 302 redirect to the object. An `<img src="/media/asset/{id}">` survives swapping the bytes behind an asset id (new slug/object key, same id) with **no content change and no re-render** — the gate re-resolves the id to the current object. The redirect is **short-cached** (`max-age=300`, no longer `immutable`) so such a swap propagates within minutes, while the object bytes stay long-cached at the CDN (each version has its own object key). A CDN in front of the gate must include the query string in its cache key (the redirect target varies by `?format`/`?w`/`?download`).
- **Two latent gate bugs fixed along the way** (the gate never worked over real HTTP before, because content used direct CDN URLs): the route was registered with OpenAPI `{param}` braces — rou3 only matches `:param`, so every request 404'd at the router before the handler ran — and the handler set the redirect via a returned `{ headers, body }` object that better-call never applies to the HTTP response (it answered `200` with an empty body). Both are fixed; the gate is now covered by tests that drive a real `Request` through `cms.router.handler`.
- **Reverted the read-path image→`{ id, slug }` resolution** shipped in 0.2.8 (`resolveImageAssets` / `ResolvedImage`). With the id-addressed gate the renderer builds the URL straight from the stored id, so no read-time resolution is needed; an `image` block property is a plain asset-id string on both the write and read paths.

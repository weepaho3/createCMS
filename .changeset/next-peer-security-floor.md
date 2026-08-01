---
'@createcms/core': minor
---

fix(deps): require Next.js >= 16.2.11 and bump runtime dependencies

**Breaking (Next.js users only):** the `next` peer range moves from `>=16` to
`>=16.2.11`. Every 16.x below that carries nine security advisories — four of
them high, including SSRF in Server Actions, a middleware/proxy bypass in App
Router applications, and SSRF via rewrites. createCMS ships a `next/middleware`
integration, so pairing it with an affected Next is a real exposure rather than
a theoretical one. `next` remains an optional peer: projects not using Next.js
are unaffected.

Runtime dependencies moved to their current releases within the existing ranges:
`better-call` 2.0.5, `nanostores` 1.4.2, `fast-xml-parser` 5.10.1, `nanoid`
5.1.16 and `ora` 9.4.1.

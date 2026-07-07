---
"@createcms/core": patch
---

Resolve the contradictory React import guidance for Server Components. The
rendering helpers (`createBlocksMap`, `BlocksRenderer`, `createBlocksRenderer`,
`createContentRenderer`) must be imported from the RSC-safe
`@createcms/core/react/blocks` subpath, not the `@createcms/core/react` barrel —
the barrel also re-exports the client hooks (`createCMSClient`, `useStore`, …),
which pull React client code into a Server Component. `pickVariant` is now also
re-exported from `@createcms/core/react/blocks`, so the whole server-safe
rendering + variant surface lives on one subpath. The reference, the package
README, and the rendering helpers' JSDoc examples now consistently point to
`@createcms/core/react/blocks` for Server Components (matching the quickstart and
the example apps); the barrel remains for Client Components.

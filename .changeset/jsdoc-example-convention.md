---
"@createcms/core": patch
---

Fix the JSDoc `@example` blocks on the endpoint methods so they match the real
client calling convention. 74 examples across the route files showed bare
arguments (e.g. `cmsClient.pages.publishBranch({ rootId, branchId })`) that don't
compile — the client wraps inputs under `body` for writes and `query` for reads
(`cmsClient.pages.publishBranch({ body: { rootId, branchId } })`). Each example
is now wrapped to match its endpoint's actual `body`/`query` schema (or takes no
argument where the endpoint has no input). The `createCMS` JSDoc's `media`
example also now uses the real `MediaConfig` shape instead of an invented one.
These examples surface in editor hover and the published `.d.ts`.

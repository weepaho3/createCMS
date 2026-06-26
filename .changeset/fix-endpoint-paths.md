---
"@createcms/core": patch
---

Fix a client/server path mismatch that made the `variables`, `templates`, and `search` namespaces unreachable from the client.

The client proxy builds every request URL as `/<namespace>/<method>` (e.g. `client.variables.listVariables()` → `/variables/listVariables`), but these endpoints were mounted at hand-written paths that didn't follow that convention (`/variables`, `/variables/get`, `/templates/create`, `/search`, …). Every such call 404'd. Handler-level tests didn't catch it because `cms.api.<ns>.<method>()` invokes the handler directly and never exercises HTTP routing.

- All `variables` endpoints now mount at `/variables/<method>` (e.g. `/variables/listVariables`, `/variables/getVariable`).
- All `templates` endpoints now mount at `/templates/<method>` (e.g. `/templates/listTemplates`, `/templates/getTemplate`).
- `search` now mounts at `/search/search` (matching `client.search.search()`).

A new test asserts every RPC endpoint is mounted at exactly `/<namespace>/<method>`, so this class of drift can't regress. (Direct-URL routes with a path parameter, like the public `/media/asset/{assetSlug}` redirect, are intentionally exempt.)

---
"@createcms/core": patch
---

Add a `link` block-property type — a language-aware link resolved to the current path at read time.

A `link` is a discriminated union over `kind`: `internal` (an entry), `external` (a URL), `email`, or `phone`. The property config takes optional `allowedKinds` and `allowedCollections`. On a `raw: false` read (`getBlockTree` / `getPublishedContent`) every kind is normalised to an `href`: an **internal** link is resolved to the target entry's **current, language-aware path** (via the same reference resolver + path resolver redirects use — the active-language sibling, ancestor-aware, following slug changes), with `fragment` / `query` appended; external/email/phone are static pass-throughs (`url` / `mailto:` / `tel:`). A gone / out-of-scope target resolves to `href: null`. With `raw: true` the stored value is returned unchanged so the editor can re-pick the target.

Unlike `reference`, a link resolves only a **path** — nothing is embedded. Internal link targets are indexed in `contentUsages` (`targetKind: 'link'`) for the usage UI, but deleting a link target is a **warning**, not a hard block (a dangling link is recoverable).

**Schema change, no backfill (beta):** the `content_usage_target` enum gains `'link'`. Recreate the database.

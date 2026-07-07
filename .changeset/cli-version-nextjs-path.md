---
"@createcms/core": patch
---

Two fixes:

- **`createcms --version` (dx-13).** It reported a hardcoded `0.0.1` regardless of
  the installed version; it now reads the real version from the package manifest
  (guarded so an unexpected layout degrades only `--version`, never the CLI).
- **Next.js guide content lookup (dx-15).** The guide looked pages up with
  `getPublishedContent({ query: { slug: \`/${slug}\` } })`, which never matched
  (the stored `slug` has no leading slash) and could not resolve nested pages. It
  now uses a catch-all route and looks up by `path` (the full published path),
  with a note on the `path` vs `slug` vs `rootId` lookup semantics.

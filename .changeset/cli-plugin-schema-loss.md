---
"@createcms/core": patch
---

Fix `createcms generate` silently dropping plugin schema.

- **i18n/consent/ab-test-live plugins were dropped (critical).** The loader's
  hand-maintained subpath allow-list was missing several bundled plugins, so
  `@createcms/core/plugins/i18n` (etc.) fell through to a stub and `generate`
  emitted a schema without the plugin's tables/columns (e.g. i18n's `language`
  and `translationKey`) while reporting success. The subpath aliases are now
  **derived from the package's own `exports` map**, so every current and future
  plugin resolves to its real module and the list can't drift again.
- **Loud abort on stub.** If any plugin still fails to resolve to its real
  module, `generate` now throws with an explanatory error instead of emitting an
  incomplete schema.
- **Bun guard.** `generate` relies on a Node module-resolution hook that Bun
  does not implement (under Bun it silently dropped *all* plugin schema). It now
  detects Bun and aborts with a clear "run under Node.js" message. The README's
  `bunx createcms generate` is corrected to `npx`.

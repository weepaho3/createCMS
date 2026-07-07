---
"@createcms/core": patch
---

Three DX fixes:

- **`createCMSClient` with plugins (dx-12).** Documented the "with plugins, use
  the curried `()(...)` form" rule for the vanilla client too (the direct call
  widens plugin actions to the generic type, silently dropping their typing).
  The vanilla-client JSDoc example now uses the curried form and no longer
  references a non-existent `useMediaLibrary` hook.
- **`generate` not-found error (dx-14).** The "No CMS config found" message now
  lists every path the CLI actually searches (all 8 candidates), not just three.
- **`sideEffects: false` (dx-16).** Marked the package side-effect-free so
  bundlers can tree-shake unused exports from consumer apps.

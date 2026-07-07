---
"@createcms/core": patch
---

TypeScript-hardening pass (ts-01 … ts-18). Pre-1.0; the breaking items are applied
cleanly. Highlights:

- **ts-01** (client timestamps): the HTTP client now types every timestamp as the
  ISO `string` the wire actually delivers, via a `Serialize<T>` mapped type at the
  client boundary (server-side `cms.api.*` still returns real `Date`s). The
  `useNotifications` poll and live push are unified on the serialized shape, so a
  notification item never mixes `string` and `Date`.
- **ts-06**: `withUser`-enrichable list endpoints (`listRoots`, `listMergeRequests`,
  `listBranches`, …) now type `createdByUser` off the user table instead of
  `unknown`, generalized from the notifications-only path.
- **ts-08**: `createCMSClient` infers `TPlugins` (default `[]`) so a no-plugins
  client no longer gets a `Record<string, unknown>` action index signature
  (`client.anyTypo` is now a compile error).
- **ts-02 / ts-03 / ts-04**: `definePluginSchema` is curried
  (`definePluginSchema<CoreTables>()({ … })`) so the schema DSL is actually
  type-checked; new `definePlugin` (keeps a literal `id` + endpoint contributions,
  rejects typo'd keys) and `defineUserConfig` (checks `exposeColumns` against the
  real user table) helpers.
- **ts-09**: config hook `action` is now the closed union of endpoint keys (dropped
  the `(string & {})` escape) — a misspelled action is a compile error, not a
  silent no-op. **ts-05**: `check-types` now type-checks the `test/` suite too.
- **ts-17**: `MediaConfig` / `OptimizationConfig` (and provider variants) are
  exported from the root. **ts-14/15**: replaced unprincipled `tx as any` /
  `scope.where as any` / `as unknown as` result-shaping casts with a typed
  `DbOrTx` alias, `SQL[]` condition arrays, and structurally-checked row builders.
- Smaller: **ts-07** stop exporting the unused `InferPluginRealtimeEvents`;
  **ts-10** made the phantom `$notifications` type-only field unmistakable;
  **ts-12** tightened `DrizzleInstance`'s schema param; **ts-18** corrected the
  `CMSMiddlewareRequest` JSDoc; **ts-16** added type-check files for the client
  `Serialize`, block-property inference, the plugin schema DSL, and `definePlugin`.

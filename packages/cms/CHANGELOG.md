# @createcms/core

## 0.2.0

### Minor Changes

- [#3](https://github.com/weepaho3/createCMS/pull/3) [`f263c1f`](https://github.com/weepaho3/createCMS/commit/f263c1fe36349bb35337ddfc158245acb5a946cd) Thanks [@weepaho3](https://github.com/weepaho3)! - Block placement constraints. Collections now take a `structure` map that controls which blocks may be nested where, replacing the removed `allowedChildBlocks` field.

  - `structure` is keyed by parent block name (or the literal `'root'`) with three mutually exclusive modes per entry: open (`{}` / `{ accepts: '*' }`), whitelist (`{ accepts: ['x'] }`, fail-closed), or blacklist (`{ excludes: ['x'] }`, fail-open). A concrete `accepts` list together with `excludes` is a compile error. Block names autocomplete against the collection's blocks and typos are caught at compile time.
  - `allowChildren` is now enforced on the server: a non-container block (without `allowChildren: true`) rejects all children. The root always accepts children.
  - `createBlock`, `moveBlock`, and `duplicateBlock` enforce these rules and throw the new `BLOCK_NOT_ALLOWED_IN_PARENT` error; the visual editor reads the same rules for drop-zone gating, so the two can't diverge.

  **Breaking:** `allowedChildBlocks` is removed — express the same intent with `structure` (e.g. `structure: { section: { accepts: ['featureItem'] } }`). Blocks that hold children must now declare `allowChildren: true`.

## 0.1.1

### Patch Changes

- [`028d2f2`](https://github.com/weepaho3/createCMS/commit/028d2f2e98f916a965b643c4ce23c8f33622679a) Thanks [@weepaho3](https://github.com/weepaho3)! - Fix `createcms generate` failing on configs that use the idiomatic
  `defineCollection` / `defineCollections` / `defineAuthMiddleware` API. The
  config-loading shim now stubs these helpers (they are pure identity functions at
  runtime), so a config written exactly as the docs show loads correctly during
  schema generation.

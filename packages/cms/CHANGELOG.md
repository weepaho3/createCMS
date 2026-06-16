# @createcms/core

## 0.1.1

### Patch Changes

- [`028d2f2`](https://github.com/weepaho3/createCMS/commit/028d2f2e98f916a965b643c4ce23c8f33622679a) Thanks [@weepaho3](https://github.com/weepaho3)! - Fix `createcms generate` failing on configs that use the idiomatic
  `defineCollection` / `defineCollections` / `defineAuthMiddleware` API. The
  config-loading shim now stubs these helpers (they are pure identity functions at
  runtime), so a config written exactly as the docs show loads correctly during
  schema generation.

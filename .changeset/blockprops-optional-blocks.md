---
"@createcms/core": patch
---

Fix `BlockProps<typeof collection, 'blockType'>` failing to compile. The helper required a non-optional `blocks` field, but `blocks` is optional on `CollectionDefinition`, so passing a collection definition errored with "Type 'undefined' is not assignable to type 'Record<string, AnyBlockDefinition>'". The constraint now accepts the optional shape and resolves it via `NonNullable`, so `BlockProps<typeof myCollection, 'myBlock'>` works and the block name still autocompletes.

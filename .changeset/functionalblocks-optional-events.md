---
"@createcms/core": patch
---

Fix `createTrackedBlocks(...).useTrackedBlock('myBlock')` rejecting a block that declared `events` when the collection is used in its declared form (e.g. `typeof myCollection`). `events` is optional on `BlockDefinition`, so the `FunctionalBlocks` key-filter saw `TEvents | undefined` and filtered out every block (`(X | undefined) extends Record<…>` is false). The key-filter now `NonNullable`s the `events` access, matching the value side — functional blocks are detected again and `fire` stays narrowed.

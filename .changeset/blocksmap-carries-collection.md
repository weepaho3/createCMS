---
"@createcms/core": minor
---

`createBlocksMap` now bundles the collection definition on the returned `BlocksMap` (a typed `_collection`), so a single object can drive both rendering and an editor — components, events, and the collection's schema/placement/grouping in one handoff, with no separate `collection` prop. `BlocksMap` gained an optional type parameter that defaults to the erased collection type, so existing `BlocksMap` annotations and `BlocksRenderer` are unaffected.

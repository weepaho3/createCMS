---
'@createcms/core': minor
---

fix(blocks): validate `position` and `targetProperties` on the block write paths

`createBlock`'s `position` was an unconstrained number handed to
`Array.prototype.splice`, so a negative value silently inserted the block near
the end of its parent's children instead of failing, and a fractional value was
truncated. It is now `z.number().int().min(0)` — matching `moveBlock`'s
`newIndex` — and the insert index is clamped to the child count.

`targetProperties` on the duplicate paths was written into content with only a
cast, bypassing the per-block property schema that every other write path
enforces. `runDuplicate` now parses it with `buildPropertiesSchema`, so declared
constraints (`maxLength`, numeric ranges, required keys) apply to duplication
too.

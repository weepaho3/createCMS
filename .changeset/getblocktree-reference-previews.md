---
"@createcms/core": patch
---

Add an opt-in `getBlockTree({ includeReferencePreviews: true })` flag that returns a `references` sidecar alongside the tree.

The sidecar is a `Record<storedReferenceValue, tree>` of the **published** render tree of every reference embedded in the entry (its own nested references resolved and `{{variables}}` substituted, through the active tenant/language scope). This lets a page editor fetch the raw editable tree **and** all embedded reusable-block previews in a single call instead of one `getPublishedContent` per reference (the N+1). Combine with `raw: true` to keep the main tree editable while still getting rendered previews. References that are not published (or out of scope) are omitted. Opt-in because the resolution is more expensive; existing `getBlockTree` callers are unaffected. Reuses the same resolution machinery as `getPublishedContent` (no duplication).

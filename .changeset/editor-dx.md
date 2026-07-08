---
"@createcms/core": patch
---

Editor-DX pass (toe-ed-01 … 13). Hardens the visual-editor write path and exposes
the primitives an editor needs, so consumers stop re-implementing package
internals.

- **`updateBlocks` now enforces structural validation** (toe-ed-01), matching the
  single-block routes: it checks the posted root `blockId` equals the entry root,
  that every written block type exists, validates each written block's properties
  against its type schema, and asserts placement over the tree. Validation is
  diff-scoped: newly-created blocks are validated strictly (required props
  enforced) while updated blocks and the root use patch semantics, and unchanged
  blocks are left alone, so a stale sibling can't block an unrelated save.
- **Lossless root-type round-trip** (toe-ed-02): posting a tree loaded from
  `getBlockTree` (whose root node is `type: 'root'`) back through `updateBlocks`
  no longer persists the literal `'root'`; the root is normalized to the
  collection type.
- **`defaultValue` is now applied** (toe-ed-09): a block property's declared
  `defaultValue` seeds newly-created blocks (lowest priority: defaults < template
  prefill < caller values). New `defaultPropertiesFor(blockDef)` export computes a
  block's initial properties for editor use.
- **Required links are enforced** (toe-ed-10): link targets (`url`/`rootId`/
  `email`/`phone`) must be non-empty, so a `required` link with an empty target is
  now rejected instead of silently passing.
- **New exports for editors:** `buildPlacementIndex`, `isPlacementAllowed`,
  `allowedChildTypes`, `PlacementIndex` (toe-ed-04); `isResolvedReference` +
  `toStoredReference` from the root entry, not just `/react` (toe-ed-07);
  `RefMode`; `getCollection(map)` / `getComponents(map)` accessors so editors stop
  reaching into `BlocksMap` underscore internals (toe-ed-06).
- **`BlockComponentProps<TProps, M extends RefMode = 'resolved'>`** is now
  parameterized (toe-ed-11), so an editor canvas rendering raw store values can
  type components instead of falling back to `any`.
- **Docs:** an `updateBlocks` reference section (body, root-type rule, validation
  scope, optimistic concurrency) and editor-guide notes on `getTemplateDefaults`
  prefill and `blk_` id minting (toe-ed-05/08/12/13).

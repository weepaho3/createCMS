---
"@createcms/core": minor
---

Block placement constraints. Collections now take a `structure` map that controls which blocks may be nested where, replacing the removed `allowedChildBlocks` field.

- `structure` is keyed by parent block name (or the literal `'root'`) with three mutually exclusive modes per entry: open (`{}` / `{ accepts: '*' }`), whitelist (`{ accepts: ['x'] }`, fail-closed), or blacklist (`{ excludes: ['x'] }`, fail-open). A concrete `accepts` list together with `excludes` is a compile error. Block names autocomplete against the collection's blocks and typos are caught at compile time.
- `allowChildren` is now enforced on the server: a non-container block (without `allowChildren: true`) rejects all children. The root always accepts children.
- `createBlock`, `moveBlock`, and `duplicateBlock` enforce these rules and throw the new `BLOCK_NOT_ALLOWED_IN_PARENT` error; the visual editor reads the same rules for drop-zone gating, so the two can't diverge.

**Breaking:** `allowedChildBlocks` is removed — express the same intent with `structure` (e.g. `structure: { section: { accepts: ['featureItem'] } }`). Blocks that hold children must now declare `allowChildren: true`.

import type { AnyBlockDefinition, CollectionStructure } from '../types';

import { CMSError } from '../errors';

/**
 * A resolved per-parent acceptance rule:
 * - `only`   — the parent holds ONLY the blocks in `set` (whitelist / `accepts`).
 * - `except` — the parent holds anything EXCEPT the blocks in `set` (blacklist / `excludes`).
 * A parent that is open (no `structure` entry, or `accepts: '*'` with no
 * `excludes`) has NO rule and accepts every block.
 */
type AcceptRule =
  | { mode: 'only'; set: Set<string> }
  | { mode: 'except'; set: Set<string> };

/**
 * Precomputed placement lookup, derived once per collection.
 *
 * - `rules` — parent block type (or `'root'`) → its {@link AcceptRule}. Parents
 *   absent from this map are open.
 * - `containers` — block types whose `allowChildren` is `true`. The root is NOT
 *   listed (it always accepts children) and is keyed as the literal `'root'`.
 */
export type PlacementIndex = {
  rules: Map<string, AcceptRule>;
  containers: Set<string>;
};

/** Builds the {@link PlacementIndex} from a collection's `structure` + blocks. */
export function buildPlacementIndex(
  structure:
    | CollectionStructure<Record<string, AnyBlockDefinition>>
    | undefined,
  blocks: Record<string, AnyBlockDefinition> | undefined,
): PlacementIndex {
  const rules = new Map<string, AcceptRule>();
  if (structure) {
    for (const [parent, entry] of Object.entries(structure)) {
      if (!entry) continue;
      const accepts = entry.accepts;
      if (Array.isArray(accepts)) {
        // Concrete whitelist (incl. the empty "holds nothing" list).
        rules.set(parent, { mode: 'only', set: new Set(accepts) });
      } else if (entry.excludes && entry.excludes.length > 0) {
        // Open base ('*' or omitted) minus an explicit blacklist.
        rules.set(parent, { mode: 'except', set: new Set(entry.excludes) });
      }
      // else: open ('*' / nothing, no excludes) — no rule.
    }
  }
  const containers = new Set<string>();
  if (blocks) {
    for (const [name, def] of Object.entries(blocks)) {
      if (def.allowChildren === true) containers.add(name);
    }
  }
  return { rules, containers };
}

/**
 * Throws `BLOCK_NOT_ALLOWED_IN_PARENT` when placing a `childType` block under a
 * `parentType` block would violate the collection's rules. `parentType` must be
 * the literal `'root'` when the parent is the collection root.
 *
 * Two gates, in order:
 *  1. Container gate — a non-root parent whose `allowChildren` is not `true`
 *     rejects every child.
 *  2. Acceptance gate — the parent's `accepts`/`excludes` rule, if any:
 *     `only` rejects a child not in the set; `except` rejects a child in the set.
 *
 * A parent with no rule (open) and the root (always a container) pass gate 1
 * and/or gate 2 trivially, so collections without a `structure` map only feel
 * the `allowChildren` gate.
 */
export function assertPlacementAllowed(
  index: PlacementIndex,
  childType: string,
  parentType: string,
): void {
  if (parentType !== 'root' && !index.containers.has(parentType))
    throw new CMSError('BLOCK_NOT_ALLOWED_IN_PARENT', {
      message: `Block '${parentType}' does not accept child blocks (its 'allowChildren' is not set)`,
      data: { childType, parentType, reason: 'not-a-container' },
    });

  const rule = index.rules.get(parentType);
  if (!rule) return;

  if (rule.mode === 'only' && !rule.set.has(childType))
    throw new CMSError('BLOCK_NOT_ALLOWED_IN_PARENT', {
      message:
        `Block '${parentType}' accepts only [${[...rule.set].join(', ')}] — ` +
        `'${childType}' is not allowed inside it`,
      data: { childType, parentType, accepts: [...rule.set] },
    });

  if (rule.mode === 'except' && rule.set.has(childType))
    throw new CMSError('BLOCK_NOT_ALLOWED_IN_PARENT', {
      message: `Block '${childType}' is not allowed inside '${parentType}' (excluded)`,
      data: { childType, parentType, excludes: [...rule.set] },
    });
}

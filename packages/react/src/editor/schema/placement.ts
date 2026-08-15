import type { AnyEditorSchema } from './types';

/**
 * A resolved per-parent acceptance rule — `only` = whitelist (`accepts: [...]`),
 * `except` = blacklist (`excludes: [...]` on an open base). An open parent has
 * no rule at all.
 */
export type PlacementRule =
  | { mode: 'only'; set: Set<string> }
  | { mode: 'except'; set: Set<string> };

/**
 * Precomputed placement lookup for one schema. Same shape and semantics as
 * `buildPlacementIndex` in core
 * (`packages/cms/src/core/blocks/placement.ts`), which the server guard
 * uses — the editor must never allow a drop the server rejects, or reject
 * one it accepts, so keep the two in lockstep.
 *
 * - `rules`: parent block type (or `'root'`) → rule; a parent absent here is open.
 * - `containers`: block types with `allowChildren: true`. The root is never
 *   listed — it always holds children — and is keyed as the literal `'root'`.
 * - `blockTypes`: every block type of the schema, in definition order (the
 *   universe `allowedChildTypes` filters).
 */
export type PlacementIndex = {
  rules: Map<string, PlacementRule>;
  containers: Set<string>;
  blockTypes: Set<string>;
};

/** Builds the {@link PlacementIndex} from a schema's `structure` and `blocks`. */
export function getPlacement(schema: AnyEditorSchema): PlacementIndex {
  const rules = new Map<string, PlacementRule>();
  if (schema.structure) {
    for (const [parent, entry] of Object.entries(schema.structure)) {
      if (!entry) continue;
      const accepts = entry.accepts;
      if (Array.isArray(accepts)) {
        // Concrete whitelist (incl. the empty "holds nothing" list); a
        // sibling `excludes` is ignored, exactly like the server.
        rules.set(parent, { mode: 'only', set: new Set(accepts) });
      } else if (entry.excludes && entry.excludes.length > 0) {
        // Open base ('*' or omitted) minus an explicit blacklist.
        rules.set(parent, { mode: 'except', set: new Set(entry.excludes) });
      }
      // else: open ('*' / nothing, no excludes) — no rule.
    }
  }
  const containers = new Set<string>();
  const blockTypes = new Set<string>();
  if (schema.blocks) {
    for (const [name, def] of Object.entries(schema.blocks)) {
      blockTypes.add(name);
      if (def.allowChildren === true) containers.add(name);
    }
  }
  return { rules, containers, blockTypes };
}

/**
 * Whether a `childType` block may be placed directly under `parentType`
 * (`'root'` for the top level). Two gates, like the server: the parent must be
 * a container (root always is), then its `accepts`/`excludes` rule must allow
 * the child. Argument order matches core's `isPlacementAllowed`.
 */
export function canPlace(
  index: PlacementIndex,
  childType: string,
  parentType: string,
): boolean {
  if (parentType !== 'root' && !index.containers.has(parentType)) return false;

  const rule = index.rules.get(parentType);
  if (!rule) return true;

  if (rule.mode === 'only') return rule.set.has(childType);
  return !rule.set.has(childType);
}

/**
 * The block types `parentType` (or `'root'`) accepts as children, in schema
 * definition order — the palette filter. `[]` for a non-container.
 */
export function allowedChildTypes(
  index: PlacementIndex,
  parentType: string,
): string[] {
  const out: string[] = [];
  for (const childType of index.blockTypes) {
    if (canPlace(index, childType, parentType)) out.push(childType);
  }
  return out;
}

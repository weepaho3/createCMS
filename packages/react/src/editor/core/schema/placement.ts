import type { AnyEditorSchema } from './types';

/** The slot every container holds its children in. */
export const DEFAULT_SLOT = 'children';

/**
 * A resolved per-parent acceptance rule for the default slot: `only` from the
 * slot's `allow` list, `except` from its `disallow` list. An open parent has
 * no rule at all.
 */
export type PlacementRule =
  | { mode: 'only'; set: Set<string> }
  | { mode: 'except'; set: Set<string> };

/**
 * Precomputed placement lookup for one schema.
 *
 * - `rules`: parent type (or `'root'`) → rule; a parent absent here is open.
 * - `containers`: types (including `'root'`) that declare a `children` slot.
 * - `blockTypes`: every component type of the schema, in definition order
 *   (the universe `allowedChildTypes` filters).
 * - `global`: the schema's `canPlace`, checked after the slot rule.
 */
export type PlacementIndex = {
  rules: Map<string, PlacementRule>;
  containers: Set<string>;
  blockTypes: Set<string>;
  global?: (childType: string, parentType: string, slot: string) => boolean;
};

/** Builds the {@link PlacementIndex} from a schema's components and slots. */
export function getPlacement(schema: AnyEditorSchema): PlacementIndex {
  const rules = new Map<string, PlacementRule>();
  const containers = new Set<string>();
  const blockTypes = new Set<string>();
  const entries: [string, AnyEditorSchema['root']][] = [
    ['root', schema.root],
    ...Object.entries(schema.components),
  ];
  for (const [type, def] of entries) {
    if (type !== 'root') blockTypes.add(type);
    const slot = def.slots?.[DEFAULT_SLOT];
    if (!slot) continue;
    containers.add(type);
    if (slot.allow) {
      // `allow` wins: a sibling `disallow` is ignored.
      rules.set(type, { mode: 'only', set: new Set(slot.allow) });
    } else if (slot.disallow && slot.disallow.length > 0) {
      rules.set(type, { mode: 'except', set: new Set(slot.disallow) });
    }
  }
  const global = schema.canPlace?.bind(schema);
  return global
    ? { rules, containers, blockTypes, global }
    : { rules, containers, blockTypes };
}

/**
 * Whether a `childType` node may be placed directly under `parentType`
 * (`'root'` for the top level): the parent must declare a `children` slot,
 * its `allow`/`disallow` rule must admit the child, and the schema's global
 * `canPlace` (when set) must agree.
 */
export function canPlace(
  index: PlacementIndex,
  childType: string,
  parentType: string,
): boolean {
  if (!index.containers.has(parentType)) return false;

  const rule = index.rules.get(parentType);
  if (rule) {
    const listed = rule.set.has(childType);
    if (rule.mode === 'only' ? !listed : listed) return false;
  }
  return index.global
    ? index.global(childType, parentType, DEFAULT_SLOT)
    : true;
}

/**
 * The component types `parentType` (or `'root'`) accepts as children, in
 * schema definition order (the palette filter). `[]` for a non-container.
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

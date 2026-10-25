import type { SlotRef } from '../document';
import type { AnyEditorSchema, SlotSpec } from './types';

import { componentOf } from './fields';

/** Why a placement is refused. */
export type PlaceErrorCode =
  | 'unknown-slot'
  | 'self-nesting'
  | 'not-allowed'
  | 'slot-full';

export type PlaceResult = { ok: true } | { ok: false; code: PlaceErrorCode };

/** What placement reads from a node: its type, where it sits, its slots. */
export type PlacementNode = {
  readonly type: string;
  readonly parent: SlotRef | null;
  readonly slots: Readonly<Record<string, readonly string[]>>;
};

/** The slots a component type declares (`'root'` for the root); `{}` when none. */
export function slotsOf(
  schema: AnyEditorSchema,
  type: string,
): Readonly<Record<string, SlotSpec>> {
  return componentOf(schema, type)?.slots ?? {};
}

/**
 * Whether `childType` passes one slot's rules: `allow` (wins over
 * `disallow`), `disallow`, the slot's `accept` and the schema's global
 * `canPlace`. Capacity (`max`) is not checked here.
 */
export function slotAccepts(
  schema: AnyEditorSchema,
  parent: { id: string; type: string },
  slot: string,
  spec: SlotSpec,
  childType: string,
): boolean {
  if (spec.allow) {
    if (!spec.allow.includes(childType)) return false;
  } else if (spec.disallow?.includes(childType)) {
    return false;
  }
  if (
    spec.accept &&
    !spec.accept({
      childType,
      parentId: parent.id,
      parentType: parent.type,
      slot,
    })
  ) {
    return false;
  }
  return schema.canPlace ? schema.canPlace(childType, parent.type, slot) : true;
}

/** True when `candidate` is `id` itself or lives below it, in any slot. */
export function isSelfOrDescendant(
  nodes: Readonly<Record<string, PlacementNode>>,
  id: string,
  candidate: string,
): boolean {
  for (
    let p: string | null = candidate;
    p !== null;
    p = nodes[p]?.parent?.id ?? null
  ) {
    if (p === id) return true;
  }
  return false;
}

/**
 * Whether a `childType` node may go into `parent.slot`. Checked in order: the
 * parent exists and declares the slot (`unknown-slot`), a moved node does not
 * go into its own subtree (`self-nesting`, pass `movingId`), the slot rules
 * admit the type (`not-allowed`), and the slot has room below its `max`
 * (`slot-full`; a node moved within the same slot does not count twice).
 * `min` is a validation rule, not a placement rule.
 */
export function canPlaceIn(
  schema: AnyEditorSchema,
  nodes: Readonly<Record<string, PlacementNode>>,
  childType: string,
  parent: SlotRef,
  options: { movingId?: string } = {},
): PlaceResult {
  const parentNode = nodes[parent.id];
  if (!parentNode) return { ok: false, code: 'unknown-slot' };
  const spec = slotsOf(schema, parentNode.type)[parent.slot];
  if (!spec) return { ok: false, code: 'unknown-slot' };
  if (
    options.movingId !== undefined &&
    isSelfOrDescendant(nodes, options.movingId, parent.id)
  ) {
    return { ok: false, code: 'self-nesting' };
  }
  if (
    !slotAccepts(
      schema,
      { id: parent.id, type: parentNode.type },
      parent.slot,
      spec,
      childType,
    )
  ) {
    return { ok: false, code: 'not-allowed' };
  }
  if (typeof spec.max === 'number') {
    const list = parentNode.slots[parent.slot] ?? [];
    const count =
      options.movingId !== undefined && list.includes(options.movingId)
        ? list.length - 1
        : list.length;
    if (count >= spec.max) return { ok: false, code: 'slot-full' };
  }
  return { ok: true };
}

/**
 * The component types `parent.slot` accepts right now, in schema definition
 * order (the palette, inserter and keyboard drag filter). A full slot
 * accepts nothing.
 */
export function allowedChildTypes(
  schema: AnyEditorSchema,
  nodes: Readonly<Record<string, PlacementNode>>,
  parent: SlotRef,
  options: { movingId?: string } = {},
): string[] {
  return Object.keys(schema.components).filter(
    (type) => canPlaceIn(schema, nodes, type, parent, options).ok,
  );
}

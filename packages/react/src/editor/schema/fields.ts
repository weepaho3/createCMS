import type { BlockProperty } from '@createcms/schema';

import type { AnyEditorSchema, SchemaField } from './types';

/**
 * The property specs of a block type, or of the root when `blockType` is the
 * literal `'root'` (the marker `getBlockTree` puts on the top node). An unknown
 * block type yields `{}` so callers can iterate without guarding.
 */
export function propertiesOf(
  schema: AnyEditorSchema,
  blockType: string,
): Record<string, BlockProperty> {
  if (blockType === 'root') return schema.root.properties;
  return schema.blocks?.[blockType]?.properties ?? {};
}

/** Fields under one `group` label; `group: null` is the bucket for ungrouped fields. */
export type FieldGroup = {
  readonly group: string | null;
  readonly fields: SchemaField[];
};

/**
 * Fields in definition order, clustered by their `group` label: named groups
 * in first-appearance order, then always last one `null` bucket holding
 * every field without a group (omitted when there is none). Definition order
 * is kept inside each group.
 */
export function groupFields(
  properties: Record<string, BlockProperty>,
): FieldGroup[] {
  const fields: SchemaField[] = Object.entries(properties).map(
    ([key, spec]) => ({ key, spec }),
  );
  return groupBy(fields, (field) => field.spec.group).map(
    ({ group, items }) => ({ group, fields: items }),
  );
}

/** A block type the palette can insert, derived from its definition. */
export type PaletteItem = {
  type: string;
  label: string;
  description?: string;
  previewImageUrl?: string;
  /** The block-picker category (the definition's `group`); undefined = ungrouped. */
  group?: string;
  /**
   * Whether the block can hold children at all (the coarse gate). Which
   * children it may hold is the schema's `structure`: ask `canPlace` /
   * `allowedChildTypes`, which need the parent context.
   */
  allowChildren: boolean;
};

/** Every insertable block type of a schema, in definition order. */
export function paletteItems(schema: AnyEditorSchema): PaletteItem[] {
  return Object.entries(schema.blocks ?? {}).map(([type, def]) => ({
    type,
    label: def.label,
    description: def.description,
    previewImageUrl: def.previewImageUrl,
    group: def.group,
    allowChildren: def.allowChildren === true,
  }));
}

/** Palette items under one `group` label; `group: null` = ungrouped bucket. */
export type PaletteGroup = {
  readonly group: string | null;
  readonly items: PaletteItem[];
};

/** Palette items clustered by `group`: same ordering rule as `groupFields`. */
export function groupPaletteItems(
  items: readonly PaletteItem[],
): PaletteGroup[] {
  return groupBy(items, (item) => item.group);
}

/**
 * Cluster items by a free-form key, preserving first-appearance order of the
 * named groups and of the items within each; every item without a key lands
 * in a single `null` bucket appended last.
 */
function groupBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string | undefined,
): { group: string | null; items: T[] }[] {
  const order: string[] = [];
  const buckets = new Map<string, T[]>();
  const ungrouped: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (key === undefined) {
      ungrouped.push(item);
      continue;
    }
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.push(item);
  }
  const out: { group: string | null; items: T[] }[] = order.map((group) => ({
    group,
    items: buckets.get(group) ?? [],
  }));
  if (ungrouped.length > 0) out.push({ group: null, items: ungrouped });
  return out;
}

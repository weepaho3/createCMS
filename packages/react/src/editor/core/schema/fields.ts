import type {
  AnyComponentDef,
  AnyEditorSchema,
  Field,
  SchemaField,
} from './types';

import { DEFAULT_SLOT } from './placement';

/**
 * The component definition of a node type: the root for the literal
 * `'root'`, an alias resolved through `schema.aliases`, `undefined` for an
 * unknown type.
 */
export function componentOf(
  schema: AnyEditorSchema,
  type: string,
): AnyComponentDef | undefined {
  if (type === 'root') return schema.root;
  return (
    schema.components[type] ?? schema.components[schema.aliases?.[type] ?? '']
  );
}

/**
 * The fields of a node type (`'root'` for the root). An unknown type yields
 * `{}` so callers can iterate without guarding.
 */
export function fieldsOf(
  schema: AnyEditorSchema,
  type: string,
): Record<string, Field> {
  return componentOf(schema, type)?.fields ?? {};
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
export function groupFields(fields: Record<string, Field>): FieldGroup[] {
  const list: SchemaField[] = Object.entries(fields).map(([key, spec]) => ({
    key,
    spec,
  }));
  return groupBy(list, (field) => field.spec.group).map(({ group, items }) => ({
    group,
    fields: items,
  }));
}

/** A component the palette can insert, derived from its definition. */
export type PaletteItem = {
  type: string;
  label: string;
  description?: string;
  icon?: string;
  previewImageUrl?: string;
  /** The palette category; undefined = uncategorised. */
  category?: string;
  /**
   * Whether the component has a `children` slot (the coarse gate). Which
   * children it may hold depends on the parent context: ask `canPlace` /
   * `allowedChildTypes`.
   */
  allowChildren: boolean;
};

/**
 * Every insertable component of a schema, in definition order. A component
 * with `permissions.insert === false` is left out.
 */
export function paletteItems(schema: AnyEditorSchema): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const [type, def] of Object.entries(schema.components)) {
    if (def.permissions?.insert === false) continue;
    const item: PaletteItem = {
      type,
      label: def.label,
      allowChildren: def.slots?.[DEFAULT_SLOT] !== undefined,
    };
    if (def.description !== undefined) item.description = def.description;
    if (def.icon !== undefined) item.icon = def.icon;
    if (def.previewImageUrl !== undefined) {
      item.previewImageUrl = def.previewImageUrl;
    }
    if (def.category !== undefined) item.category = def.category;
    items.push(item);
  }
  return items;
}

/** Palette items under one category; `category: null` = uncategorised bucket. */
export type PaletteGroup = {
  readonly category: string | null;
  readonly items: PaletteItem[];
};

/** Palette items clustered by `category`: same ordering rule as `groupFields`. */
export function groupPaletteItems(
  items: readonly PaletteItem[],
): PaletteGroup[] {
  return groupBy(items, (item) => item.category).map(({ group, items }) => ({
    category: group,
    items,
  }));
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

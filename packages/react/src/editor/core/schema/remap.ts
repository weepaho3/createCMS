import type { JsonValue, NodeData } from '../document';
import type { AnyEditorSchema, Field } from './types';

import { fieldsOf } from './fields';

/** Rewrites the ids inside one prop value; return the value unchanged when it holds none. */
export type RewriteRefs = (
  value: JsonValue,
  map: ReadonlyMap<string, string>,
  field: Field,
) => JsonValue;

export type RemapIdsOptions = {
  /** Field definitions per node type; without a schema only ids change. */
  schema?: AnyEditorSchema;
  /** Overrides the per-field rewrite for every field. */
  rewriteRefs?: RewriteRefs;
};

const isRecord = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The default rewrite: a `link` whose `fragment` names a block of the copied
 * subtree points at the copy; `list` and `object` values are rewritten
 * element by element; a field's own `rewriteRefs` wins.
 */
function defaultRewrite(
  value: JsonValue,
  map: ReadonlyMap<string, string>,
  field: Field,
): JsonValue {
  if (field.rewriteRefs) {
    // The union of per-kind value types narrows the parameter to `never`;
    // the value here is the one stored for this very field.
    const own = field.rewriteRefs as (
      value: JsonValue,
      map: ReadonlyMap<string, string>,
    ) => JsonValue;
    return own(value, map);
  }
  if (field.type === 'link') {
    if (!isRecord(value) || typeof value.fragment !== 'string') return value;
    const target = map.get(value.fragment);
    return target ? { ...value, fragment: target } : value;
  }
  if (field.type === 'list') {
    return Array.isArray(value)
      ? value.map((item) => defaultRewrite(item, map, field.of))
      : value;
  }
  if (field.type === 'object') {
    if (!isRecord(value)) return value;
    const out: Record<string, JsonValue> = { ...value };
    for (const [key, nested] of Object.entries(field.fields)) {
      const item = value[key];
      if (item !== undefined) out[key] = defaultRewrite(item, map, nested);
    }
    return out;
  }
  return value;
}

/**
 * A copy of `subtree` with a fresh id for every node (from `genId`) and every
 * reference inside the subtree rewritten to the copies: with a `schema`, each
 * field's `rewriteRefs`, or the default (`link` fragments, recursively
 * through `list` and `object`). References to nodes outside the subtree stay
 * as they are. Returns the copy and the old-to-new id map.
 */
export function remapIds(
  subtree: NodeData,
  genId: () => string,
  options: RemapIdsOptions = {},
): { node: NodeData; map: Map<string, string> } {
  const map = new Map<string, string>();
  const collect = (node: NodeData): void => {
    map.set(node.id, genId());
    for (const children of Object.values(node.slots ?? {})) {
      for (const child of children) collect(child);
    }
  };
  collect(subtree);

  const rewrite = options.rewriteRefs ?? defaultRewrite;
  const copy = (node: NodeData): NodeData => {
    const fields = options.schema ? fieldsOf(options.schema, node.type) : {};
    const props: Record<string, JsonValue> = {};
    for (const [key, value] of Object.entries(node.props)) {
      const field = fields[key];
      props[key] = field ? rewrite(value, map, field) : value;
    }
    const out: NodeData = { ...node, id: map.get(node.id)!, props };
    if (node.slots) {
      const slots: Record<string, NodeData[]> = {};
      for (const [slot, children] of Object.entries(node.slots)) {
        slots[slot] = children.map(copy);
      }
      out.slots = slots;
    }
    return out;
  };
  return { node: copy(subtree), map };
}

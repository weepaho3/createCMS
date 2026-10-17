import type { JsonValue } from '../document';
import type {
  AnyComponentDef,
  AnyEditorSchema,
  Field,
  FieldContext,
} from './types';

import { componentOf } from './fields';

/** What `fieldContextFor` needs to know about a node. */
export type ContextNode = {
  readonly type: string;
  readonly parent: { readonly id: string } | null;
  readonly props: Readonly<Record<string, unknown>>;
};

/**
 * Whether a field is shown for these props: `hidden: true` hides it, a
 * `hidden` predicate hides it when it returns `true`, and `when` shows it
 * only while `props[when.field]` equals `when.eq`. Never evaluates strings.
 */
export function isFieldVisible(
  field: Field,
  props: Record<string, unknown>,
  ctx: FieldContext,
): boolean {
  if (field.hidden === true) return false;
  if (typeof field.hidden === 'function' && field.hidden(props, ctx)) {
    return false;
  }
  if (field.when && !jsonEqual(props[field.when.field], field.when.eq)) {
    return false;
  }
  return true;
}

/**
 * The fields of a component after its `resolveFields` overrides: each
 * returned partial is merged over the declared field.
 */
export function resolveFields(
  def: AnyComponentDef,
  props: Record<string, unknown>,
  ctx: FieldContext,
): Record<string, Field> {
  if (!def.resolveFields) return def.fields;
  const overrides = def.resolveFields({ props }, ctx);
  const out: Record<string, Field> = {};
  for (const [key, field] of Object.entries(def.fields)) {
    const patch = overrides[key];
    out[key] = patch ? ({ ...field, ...patch } as Field) : field;
  }
  return out;
}

/**
 * Memoised `resolveFields` + `isFieldVisible` per node: the result is reused
 * while the node's props object and context keep their identity.
 */
export function createFieldResolver(): (
  def: AnyComponentDef,
  props: Record<string, unknown>,
  ctx: FieldContext,
) => Record<string, Field> {
  const cache = new WeakMap<
    object,
    { def: AnyComponentDef; ctx: FieldContext; fields: Record<string, Field> }
  >();
  return (def, props, ctx) => {
    const hit = cache.get(props);
    if (hit && hit.def === def && sameContext(hit.ctx, ctx)) return hit.fields;
    const resolved = resolveFields(def, props, ctx);
    const fields: Record<string, Field> = {};
    for (const [key, field] of Object.entries(resolved)) {
      if (isFieldVisible(field, props, ctx)) fields[key] = field;
    }
    cache.set(props, { def, ctx, fields });
    return fields;
  };
}

/**
 * The {@link FieldContext} of one node: the values its ancestors expose via
 * `providesContext` (nearest ancestor wins, filtered by the node's
 * `usesContext` when declared) and the schema's `metadata`.
 */
export function fieldContextFor(
  schema: AnyEditorSchema,
  getNode: (id: string) => ContextNode | undefined,
  nodeId: string,
): FieldContext {
  const node = getNode(nodeId);
  const type = node?.type ?? '';
  const uses = node ? componentOf(schema, node.type)?.usesContext : undefined;
  const context: Record<string, unknown> = {};
  let parentId = node?.parent?.id ?? null;
  while (parentId !== null) {
    const parent = getNode(parentId);
    if (!parent) break;
    const provides = componentOf(schema, parent.type)?.providesContext;
    if (provides) {
      for (const [name, key] of Object.entries(provides)) {
        if (name in context) continue;
        if (uses && !uses.includes(name)) continue;
        context[name] = parent.props[key];
      }
    }
    parentId = parent.parent?.id ?? null;
  }
  return {
    nodeId,
    type,
    context,
    metadata: schema.metadata ?? {},
  };
}

function sameContext(a: FieldContext, b: FieldContext): boolean {
  if (a.nodeId !== b.nodeId || a.metadata !== b.metadata) return false;
  const keys = Object.keys(a.context);
  if (keys.length !== Object.keys(b.context).length) return false;
  return keys.every((key) => Object.is(a.context[key], b.context[key]));
}

function jsonEqual(a: unknown, b: JsonValue): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  ) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

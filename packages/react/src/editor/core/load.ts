import type { EditorDocument, JsonValue, NodeData } from './document';
import type { AnyEditorSchema, Migration } from './schema';

import { componentOf, fieldsOf, validateField } from './schema';

/** What the load pipeline changed or found, so nothing changes silently. */
export type DiagnosticCode =
  | 'alias'
  | 'migrated'
  | 'migration-missing'
  | 'migration-failed'
  | 'unknown-type'
  | 'invalid-prop'
  | 'duplicate-id'
  | 'invalid-node'
  | 'reference-cycle'
  | 'reference-depth'
  | 'reference-missing';

export type Diagnostic = {
  readonly code: DiagnosticCode;
  readonly severity: 'info' | 'warning' | 'error';
  /** Ids from the root to the node, then the prop key where one applies. */
  readonly path: readonly string[];
  readonly message: string;
  /** The value before a repair, so it is never lost. */
  readonly value?: JsonValue;
};

export type LoadResult = {
  readonly doc: EditorDocument;
  readonly diagnostics: readonly Diagnostic[];
};

/** The input is not a document at all (no root object); nothing could be loaded. */
export class DocumentLoadError extends Error {
  readonly diagnostics: readonly Diagnostic[];

  constructor(message: string, diagnostics: readonly Diagnostic[]) {
    super(message);
    this.name = 'DocumentLoadError';
    this.diagnostics = diagnostics;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const STRUCTURED_KEYS = new Set(['props', 'slots', 'type']);

/** A migration result that names its parts (`{ props, slots?, type? }`). */
function isStructured(result: unknown): result is {
  props: Record<string, JsonValue>;
  slots?: Record<string, NodeData[]>;
  type?: string;
} {
  return (
    isRecord(result) &&
    isRecord(result.props) &&
    Object.keys(result).every((key) => STRUCTURED_KEYS.has(key))
  );
}

type Context = {
  schema: AnyEditorSchema;
  diagnostics: Diagnostic[];
  seen: Set<string>;
  genId: () => string;
};

function migrate(
  node: NodeData,
  path: readonly string[],
  ctx: Context,
): NodeData {
  let current = node;
  const alias = ctx.schema.aliases?.[current.type];
  if (alias !== undefined && current.type !== 'root') {
    ctx.diagnostics.push({
      code: 'alias',
      severity: 'info',
      path,
      message: `type "${current.type}" is now "${alias}"`,
    });
    current = { ...current, type: alias };
  }
  const def = componentOf(ctx.schema, current.type);
  const target = def?.version ?? 0;
  const steps: readonly Migration[] = def?.migrations ?? [];
  while ((current.v ?? 0) < target) {
    const from = current.v ?? 0;
    const step = steps.find((m) => m.to === from + 1);
    if (!step) {
      ctx.diagnostics.push({
        code: 'migration-missing',
        severity: 'error',
        path,
        message: `no migration of "${current.type}" from version ${from} to ${from + 1}`,
      });
      break;
    }
    let result: ReturnType<Migration['up']>;
    try {
      result = step.up(current.props, { node: current });
    } catch (error) {
      ctx.diagnostics.push({
        code: 'migration-failed',
        severity: 'error',
        path,
        message: `migration of "${current.type}" to version ${step.to} threw: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      break;
    }
    const next: NodeData = isStructured(result)
      ? {
          ...current,
          props: result.props,
          type: result.type ?? current.type,
          slots: result.slots ?? current.slots,
          v: step.to,
        }
      : { ...current, props: result, v: step.to };
    ctx.diagnostics.push({
      code: 'migrated',
      severity: 'info',
      path,
      message: `"${current.type}" migrated from version ${from} to ${step.to}`,
    });
    current = next;
  }
  return current;
}

function repairProps(
  node: NodeData,
  path: readonly string[],
  ctx: Context,
): NodeData {
  const fields = fieldsOf(ctx.schema, node.type);
  let props: Record<string, JsonValue> | null = null;
  for (const [key, field] of Object.entries(fields)) {
    if (!(key in node.props)) continue;
    const value = node.props[key];
    const wrongType = validateField(field, value).some(
      (error) => error.code === 'type',
    );
    if (!wrongType) continue;
    props ??= { ...node.props };
    const fallback = field.defaultValue as JsonValue | undefined;
    if (fallback === undefined) delete props[key];
    else props[key] = fallback;
    ctx.diagnostics.push({
      code: 'invalid-prop',
      severity: 'warning',
      path: [...path, key],
      message:
        fallback === undefined
          ? `"${key}" had the wrong type and was cleared`
          : `"${key}" had the wrong type and was reset to its default`,
      value,
    });
  }
  return props ? { ...node, props } : node;
}

function visit(
  input: unknown,
  path: readonly string[],
  ctx: Context,
): NodeData | null {
  if (
    !isRecord(input) ||
    typeof input.id !== 'string' ||
    typeof input.type !== 'string'
  ) {
    ctx.diagnostics.push({
      code: 'invalid-node',
      severity: 'error',
      path,
      message: 'a node without a string id and type was left out',
      value: input as JsonValue,
    });
    return null;
  }
  let id = input.id;
  if (ctx.seen.has(id)) {
    const fresh = ctx.genId();
    ctx.diagnostics.push({
      code: 'duplicate-id',
      severity: 'warning',
      path: [...path, id],
      message: `duplicate id "${id}" was replaced by "${fresh}"`,
    });
    id = fresh;
  }
  ctx.seen.add(id);
  const nodePath = [...path, id];
  let node: NodeData = {
    id,
    type: input.type,
    props: isRecord(input.props)
      ? (input.props as Record<string, JsonValue>)
      : {},
  };
  if (typeof input.v === 'number') node.v = input.v;
  if (isRecord(input.meta)) node.meta = input.meta as Record<string, JsonValue>;
  if (isRecord(input.slots))
    node.slots = input.slots as Record<string, NodeData[]>;

  node = migrate(node, nodePath, ctx);
  if (node.type !== 'root' && !componentOf(ctx.schema, node.type)) {
    ctx.diagnostics.push({
      code: 'unknown-type',
      severity: 'warning',
      path: nodePath,
      message: `type "${node.type}" is not in the schema; it is kept as stored`,
    });
  } else {
    node = repairProps(node, nodePath, ctx);
  }

  if (node.slots) {
    const slots: Record<string, NodeData[]> = {};
    for (const [name, children] of Object.entries(node.slots)) {
      const list = Array.isArray(children) ? children : [];
      slots[name] = list
        .map((child) => visit(child, nodePath, ctx))
        .filter((child): child is NodeData => child !== null);
    }
    node = { ...node, slots };
  }
  return node;
}

/**
 * The load pipeline: checks the shape, migrates every node to its
 * component's `version` (renamed types through `aliases`, then `migrations`
 * step by step), and repairs what would break the editor: duplicate ids get
 * fresh ones, props of the wrong type fall back to their default, nodes
 * without an id or type are left out. Every change is a `Diagnostic` with
 * the old value where one was replaced; unknown types are reported and kept
 * as stored. Throws `DocumentLoadError` when the input has no root node.
 */
export function loadDocument(
  input: unknown,
  schema: AnyEditorSchema,
  options: { genId: () => string },
): LoadResult {
  const diagnostics: Diagnostic[] = [];
  if (!isRecord(input) || !isRecord(input.root)) {
    throw new DocumentLoadError('the document has no root node', [
      {
        code: 'invalid-node',
        severity: 'error',
        path: [],
        message: 'the document has no root node',
      },
    ]);
  }
  const ctx: Context = {
    schema,
    diagnostics,
    seen: new Set(),
    genId: options.genId,
  };
  const root = visit(input.root, [], ctx);
  if (!root) {
    throw new DocumentLoadError('the root node is invalid', diagnostics);
  }
  const schemaVersion =
    typeof input.schemaVersion === 'number' ? input.schemaVersion : 0;
  return { doc: { schemaVersion, root }, diagnostics };
}

import type { EditorDocument, JsonValue, NodeData } from './document';
import type { Diagnostic } from './load';
import type { EditorPlugin } from './plugin';
import type { AnyComponentDef, AnyEditorSchema } from './schema';
import type { EditorStore } from './store';

import { componentOf } from './schema';

/** The node type of a reusable section reference. */
export const REF_TYPE = '$ref';
/** References nested deeper than this are not resolved. */
export const REF_MAX_DEPTH = 3;

/** Which document a section reference shows. */
export type SectionRef = { readonly collection: string; readonly id: string };

/** Prop overrides per node id of the referenced document. */
export type SectionOverrides = Readonly<
  Record<string, Readonly<Record<string, JsonValue>>>
>;

/** A resolved section: the referenced root's children, nested references expanded. */
export type ResolvedSection = {
  readonly nodes: readonly NodeData[];
  readonly diagnostics: readonly Diagnostic[];
};

export type SectionResolver = {
  /** Resolves (cached per reference) and applies `overrides`. */
  resolve(
    ref: SectionRef,
    overrides?: SectionOverrides,
  ): Promise<ResolvedSection>;
  /** Drops cached documents (all, or one reference). */
  invalidate(ref?: SectionRef): void;
};

const keyOf = (ref: SectionRef): string => `${ref.collection}/${ref.id}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The `ref` prop of a `$ref` node, or `null` when it is malformed. */
export function sectionRefOf(node: {
  readonly props: Readonly<Record<string, unknown>>;
}): SectionRef | null {
  const ref = node.props.ref;
  if (!isRecord(ref)) return null;
  const { collection, id } = ref;
  return typeof collection === 'string' && typeof id === 'string'
    ? { collection, id }
    : null;
}

/** The `overrides` prop of a `$ref` node (empty when absent or malformed). */
export function sectionOverridesOf(node: {
  readonly props: Readonly<Record<string, unknown>>;
}): SectionOverrides {
  const overrides = node.props.overrides;
  return isRecord(overrides) ? (overrides as SectionOverrides) : {};
}

/**
 * `nodes` with `overrides` applied: per node id, only the props its
 * component lists in `exposedProps`; everything else is ignored.
 */
export function applyOverrides(
  nodes: readonly NodeData[],
  overrides: SectionOverrides,
  schema: AnyEditorSchema,
): NodeData[] {
  const apply = (node: NodeData): NodeData => {
    const patch = overrides[node.id];
    const exposed = componentOf(schema, node.type)?.exposedProps ?? [];
    let props = node.props;
    if (patch) {
      props = { ...props };
      for (const key of exposed) {
        if (key in patch) props[key] = patch[key] as JsonValue;
      }
    }
    if (!node.slots) return props === node.props ? node : { ...node, props };
    const slots: Record<string, NodeData[]> = {};
    for (const [name, children] of Object.entries(node.slots)) {
      slots[name] = children.map(apply);
    }
    return { ...node, props, slots };
  };
  return nodes.map(apply);
}

/**
 * Resolves `$ref` nodes through `resolveReference` (an adapter's): each
 * document is fetched once and cached, nested references are expanded up
 * to `maxDepth`, and a cycle, the depth limit or a failed fetch end that
 * branch with a diagnostic instead of looping.
 */
export function createSectionResolver(options: {
  resolveReference: (ref: SectionRef) => Promise<EditorDocument>;
  schema: AnyEditorSchema;
  maxDepth?: number;
}): SectionResolver {
  const maxDepth = options.maxDepth ?? REF_MAX_DEPTH;
  const cache = new Map<string, Promise<EditorDocument>>();
  const fetch = (ref: SectionRef): Promise<EditorDocument> => {
    const key = keyOf(ref);
    let hit = cache.get(key);
    if (!hit) {
      hit = options.resolveReference(ref);
      // A failed fetch is retried on the next resolve.
      hit.catch(() => cache.delete(key));
      cache.set(key, hit);
    }
    return hit;
  };

  const expand = async (
    ref: SectionRef,
    chain: readonly string[],
    diagnostics: Diagnostic[],
  ): Promise<NodeData[]> => {
    const key = keyOf(ref);
    const path = [...chain, key];
    if (chain.includes(key)) {
      diagnostics.push({
        code: 'reference-cycle',
        severity: 'error',
        path,
        message: `section "${key}" references itself`,
      });
      return [];
    }
    if (chain.length >= maxDepth) {
      diagnostics.push({
        code: 'reference-depth',
        severity: 'warning',
        path,
        message: `section "${key}" is nested deeper than ${maxDepth}`,
      });
      return [];
    }
    let doc: EditorDocument;
    try {
      doc = await fetch(ref);
    } catch (error) {
      diagnostics.push({
        code: 'reference-missing',
        severity: 'error',
        path,
        message: `section "${key}" could not be loaded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return [];
    }
    const walk = async (nodes: readonly NodeData[]): Promise<NodeData[]> => {
      const out: NodeData[] = [];
      for (const node of nodes) {
        if (node.type === REF_TYPE) {
          const nested = sectionRefOf(node);
          if (!nested) continue;
          const inner = await expand(nested, path, diagnostics);
          out.push(
            ...applyOverrides(inner, sectionOverridesOf(node), options.schema),
          );
          continue;
        }
        if (!node.slots) {
          out.push(node);
          continue;
        }
        const slots: Record<string, NodeData[]> = {};
        for (const [name, children] of Object.entries(node.slots)) {
          slots[name] = await walk(children);
        }
        out.push({ ...node, slots });
      }
      return out;
    };
    return walk(Object.values(doc.root.slots ?? {}).flat());
  };

  return {
    async resolve(ref, overrides = {}) {
      const diagnostics: Diagnostic[] = [];
      const nodes = await expand(ref, [], diagnostics);
      return {
        nodes: applyOverrides(nodes, overrides, options.schema),
        diagnostics,
      };
    },
    invalidate(ref) {
      if (ref) cache.delete(keyOf(ref));
      else cache.clear();
    },
  };
}

/** The `$ref` block: a reference and its overrides, both kept out of the plain form. */
export function sectionBlock(
  options: { label?: string } = {},
): AnyComponentDef {
  return {
    label: options.label ?? 'Section',
    fields: {
      ref: { type: 'custom', kind: 'sectionRef', label: 'Section' },
      overrides: {
        type: 'custom',
        kind: 'sectionOverrides',
        label: 'Overrides',
      },
    },
  };
}

/**
 * Replaces a `$ref` node with an editable copy of its resolved section
 * (fresh ids, overrides applied) in one undo step. Resolves `false` when
 * the node is no reference, its section is empty or the paste was refused.
 */
export async function detachSection(
  store: EditorStore,
  id: string,
  resolver: SectionResolver,
): Promise<boolean> {
  const node = store.getDoc().nodes[id];
  const ref = node && node.type === REF_TYPE ? sectionRefOf(node) : null;
  if (!node || !ref) return false;
  const { nodes } = await resolver.resolve(ref, sectionOverridesOf(node));
  if (nodes.length === 0) return false;
  return store.dispatch({ type: 'node.detach', payload: { id, nodes } }).ok;
}

/**
 * Adds the `$ref` block and the `block.detach` command (on the primary
 * selection) to an editor.
 */
export function sectionsPlugin(options: {
  resolver: SectionResolver;
  label?: string;
}): EditorPlugin {
  return {
    name: 'sections',
    blocks: { [REF_TYPE]: sectionBlock({ label: options.label }) },
    commands: {
      'block.detach': {
        label: 'Detach section',
        run: (store) => {
          const [id] = store.getSession().selection;
          return id === undefined
            ? false
            : detachSection(store, id, options.resolver);
        },
        canExecute: (store) => {
          const [id] = store.getSession().selection;
          return (
            id !== undefined && store.getDoc().nodes[id]?.type === REF_TYPE
          );
        },
      },
    },
  };
}

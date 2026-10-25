import type { EditorDocument, JsonValue, NodeData } from '../document';
import type { AnyEditorSchema } from '../schema/types';

import { DEFAULT_SLOT } from '../schema/fields';
import { slotsOf } from '../schema/placement';
import { remapIds } from '../schema/remap';
import { createBlockId } from '../store/id';

/** One component of Puck's `Data` (`{ type, props: { id, ... } }`). */
export type PuckComponentData = {
  type: string;
  props: { id?: string } & Record<string, unknown>;
  readOnly?: Record<string, boolean>;
};

/**
 * Puck's document shape: `root.props`, the top-level `content`, and, from
 * releases before slots, `zones` keyed `"<component id>:<zone>"`.
 */
export type PuckData = {
  root: { props?: Record<string, unknown> } & Record<string, unknown>;
  content: PuckComponentData[];
  zones?: Record<string, PuckComponentData[]>;
};

export type PuckInteropOptions = {
  /** The editor schema: its declared slots decide which props hold children. */
  schema: AnyEditorSchema;
  /** The root slot Puck's `content` maps to. Default `children`. */
  rootSlot?: string;
  /** Mints the new ids on import. Default `createBlockId`. */
  genId?: () => string;
  /** Keep Puck's ids (`HeadingBlock-1a2b...`) instead of minting new ones. */
  keepIds?: boolean;
  /** `schemaVersion` of the imported document. Default 1. */
  schemaVersion?: number;
};

const isComponent = (value: unknown): value is PuckComponentData =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { type?: unknown }).type === 'string' &&
  typeof (value as { props?: unknown }).props === 'object';

/**
 * An editor document from Puck's `Data`. Props named like a slot the
 * schema declares become that slot's children; legacy `zones` become slots
 * of their component (`"<id>:<zone>"`) or of the root (`"root:<zone>"`).
 * `readOnly` flags are dropped, and every node gets a fresh id (Puck ids
 * carry the type name) unless `keepIds` is set.
 */
export function fromPuckData(
  data: PuckData,
  options: PuckInteropOptions,
): EditorDocument {
  const rootSlot = options.rootSlot ?? DEFAULT_SLOT;
  let counter = 0;
  const fallbackId = (type: string) => `${type}-${(counter += 1)}`;
  const zonesOf = (id: string): Record<string, PuckComponentData[]> => {
    const out: Record<string, PuckComponentData[]> = {};
    for (const [key, items] of Object.entries(data.zones ?? {})) {
      const at = key.lastIndexOf(':');
      if (at > 0 && key.slice(0, at) === id) out[key.slice(at + 1)] = items;
    }
    return out;
  };
  const convert = (component: PuckComponentData): NodeData => {
    const { id, ...rest } = component.props;
    const nodeId =
      typeof id === 'string' && id !== '' ? id : fallbackId(component.type);
    const declared = new Set(
      Object.keys(slotsOf(options.schema, component.type)),
    );
    const props: Record<string, JsonValue> = {};
    const slots: Record<string, NodeData[]> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (
        declared.has(key) &&
        Array.isArray(value) &&
        value.every(isComponent)
      ) {
        slots[key] = value.map(convert);
      } else {
        props[key] = value as JsonValue;
      }
    }
    for (const [zone, items] of Object.entries(zonesOf(nodeId))) {
      slots[zone] = [...(slots[zone] ?? []), ...items.map(convert)];
    }
    const node: NodeData = { id: nodeId, type: component.type, props };
    if (Object.keys(slots).length > 0) node.slots = slots;
    return node;
  };

  const rootProps: Record<string, JsonValue> = {};
  const rootSlots: Record<string, NodeData[]> = {
    [rootSlot]: data.content.map(convert),
  };
  // Older Puck data keeps root fields next to `props` instead of inside it.
  const { props: rootFieldProps, ...legacyRoot } = data.root;
  const rootDeclared = new Set(Object.keys(slotsOf(options.schema, 'root')));
  for (const [key, value] of Object.entries({
    ...legacyRoot,
    ...rootFieldProps,
  })) {
    if (
      rootDeclared.has(key) &&
      Array.isArray(value) &&
      value.every(isComponent)
    ) {
      rootSlots[key] = value.map(convert);
    } else {
      rootProps[key] = value as JsonValue;
    }
  }
  for (const [zone, items] of Object.entries(zonesOf('root'))) {
    rootSlots[zone] = [...(rootSlots[zone] ?? []), ...items.map(convert)];
  }
  const root: NodeData = {
    id: 'root',
    type: 'root',
    props: rootProps,
    slots: rootSlots,
  };
  const remapped = options.keepIds
    ? root
    : remapIds(root, options.genId ?? createBlockId, {
        schema: options.schema,
      }).node;
  return { schemaVersion: options.schemaVersion ?? 1, root: remapped };
}

/**
 * Puck's `Data` from an editor document, the inverse of
 * {@link fromPuckData}: the root slot becomes `content`, every other slot a
 * prop of its component holding the children, and node ids become
 * `props.id`.
 */
export function toPuckData(
  doc: EditorDocument,
  options: Pick<PuckInteropOptions, 'rootSlot'> = {},
): PuckData {
  const rootSlot = options.rootSlot ?? DEFAULT_SLOT;
  const convert = (node: NodeData): PuckComponentData => {
    const props: PuckComponentData['props'] = { id: node.id, ...node.props };
    for (const [slot, children] of Object.entries(node.slots ?? {})) {
      props[slot] = children.map(convert);
    }
    return { type: node.type, props };
  };
  const rootProps: Record<string, unknown> = { ...doc.root.props };
  for (const [slot, children] of Object.entries(doc.root.slots ?? {})) {
    if (slot !== rootSlot) rootProps[slot] = children.map(convert);
  }
  return {
    root: { props: rootProps },
    content: (doc.root.slots?.[rootSlot] ?? []).map(convert),
  };
}

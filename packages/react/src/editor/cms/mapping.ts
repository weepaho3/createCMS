import type {
  AnyCollectionDefinition,
  BlockProperty,
  BlockTreeNode,
  ListElementSpec,
} from '@createcms/schema';

import type {
  AnyComponentDef,
  AnyEditorSchema,
  EditorDocument,
  Field,
  JsonValue,
  MediaValue,
  NodeData,
  ReferenceValue,
  SlotSpec,
} from '../core';

import { DEFAULT_SLOT, EditorAdapterError } from '../core';

/** Schema version stamped on documents mapped from createcms trees. */
export const CMS_SCHEMA_VERSION = 1;

type MapElement<E> = E extends { type: 'string' }
  ? Omit<E, 'type'> & { type: 'text' }
  : E extends { type: 'image' }
    ? Omit<E, 'type'> & { type: 'media' }
    : E;

type MapProperty<P> = P extends { type: 'string' }
  ? Omit<P, 'type'> & { type: 'text' }
  : P extends { type: 'image' }
    ? Omit<P, 'type' | 'defaultValue'> & {
        type: 'media';
        defaultValue?: MediaValue;
      }
    : P extends { type: 'reference' }
      ? Omit<P, 'defaultValue'> & { defaultValue?: ReferenceValue }
      : P extends { type: 'list'; of: infer E }
        ? Omit<P, 'of'> & { of: MapElement<E> }
        : P;

type MapProperties<R> = { [K in keyof R]: MapProperty<R[K]> };

type BlocksOfCollection<C extends AnyCollectionDefinition> = NonNullable<
  C['blocks']
>;

/** The editor schema `fromCollection(C)` returns, with the field types kept. */
export type FromCollection<C extends AnyCollectionDefinition> = {
  root: {
    label: string;
    fields: MapProperties<C['root']['properties']>;
    slots: { children: SlotSpec };
  };
  components: {
    [K in keyof BlocksOfCollection<C>]: {
      label: string;
      description?: string;
      category?: string;
      previewImageUrl?: string;
      fields: MapProperties<BlocksOfCollection<C>[K]['properties']>;
      slots?: { children: SlotSpec };
    };
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Copies the keys of `from` that are set into `to`. */
function copyDefined<T extends object>(
  to: T,
  from: Record<string, unknown>,
  keys: readonly string[],
): T {
  for (const key of keys) {
    if (from[key] !== undefined)
      (to as Record<string, unknown>)[key] = from[key];
  }
  return to;
}

const SHARED_KEYS = [
  'label',
  'description',
  'placeholder',
  'group',
  'required',
] as const;
const TEXT_KEYS = ['minLength', 'maxLength', 'pattern'] as const;

function elementField(spec: ListElementSpec): Field {
  return propertyField(spec as BlockProperty, 'list element');
}

/** Maps one createcms property to an editor field. */
function propertyField(spec: BlockProperty, key: string): Field {
  const raw: Record<string, unknown> = { ...spec };
  const base = copyDefined({}, raw, SHARED_KEYS);
  const withDefault = (field: Field, value: unknown): Field =>
    value === undefined ? field : ({ ...field, defaultValue: value } as Field);
  switch (spec.type) {
    case 'string':
      return withDefault(
        copyDefined({ ...base, type: 'text' }, raw, TEXT_KEYS) as Field,
        raw.defaultValue,
      );
    case 'richText':
      return withDefault(
        copyDefined({ ...base, type: 'richText' }, raw, TEXT_KEYS) as Field,
        raw.defaultValue,
      );
    case 'number':
      return withDefault(
        copyDefined({ ...base, type: 'number' }, raw, ['min', 'max']) as Field,
        raw.defaultValue,
      );
    case 'boolean':
    case 'date':
      return withDefault(
        { ...base, type: spec.type } as Field,
        raw.defaultValue,
      );
    case 'select':
      return withDefault(
        { ...base, type: 'select', options: spec.options } as Field,
        raw.defaultValue,
      );
    case 'image':
      return withDefault(
        { ...base, type: 'media' } as Field,
        typeof raw.defaultValue === 'string'
          ? { assetId: raw.defaultValue }
          : undefined,
      );
    case 'reference':
      return withDefault(
        { ...base, type: 'reference', collection: spec.collection } as Field,
        typeof raw.defaultValue === 'string'
          ? { id: raw.defaultValue }
          : undefined,
      );
    case 'link':
      return withDefault(
        copyDefined({ ...base, type: 'link' }, raw, [
          'allowedKinds',
          'allowedCollections',
        ]) as Field,
        raw.defaultValue,
      );
    case 'list':
      return copyDefined(
        { ...base, type: 'list', of: elementField(spec.of) },
        raw,
        ['min', 'max'],
      ) as Field;
    default:
      throw new EditorAdapterError(
        'validation',
        `fromCollection: property "${key}" has the unsupported type "${String((spec as { type?: unknown }).type)}"`,
        { key, type: (spec as { type?: unknown }).type },
      );
  }
}

function fieldsFrom(
  properties: Record<string, BlockProperty>,
): Record<string, Field> {
  const fields: Record<string, Field> = {};
  for (const [key, spec] of Object.entries(properties)) {
    fields[key] = propertyField(spec, key);
  }
  return fields;
}

/** The `children` slot rule of `parent` from the collection's `structure` map. */
/** The block names of a structure list; `undefined` for `'*'` or no list. */
function blockNames(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((name): name is string => typeof name === 'string');
}

function childrenSlot(def: AnyCollectionDefinition, parent: string): SlotSpec {
  const entry = def.structure?.[parent];
  if (!entry) return {};
  const accepts = blockNames(entry.accepts);
  if (accepts) return { allow: accepts };
  const excludes = blockNames(entry.excludes);
  if (excludes && excludes.length > 0) return { disallow: excludes };
  return {};
}

/**
 * Translates a createcms collection definition into an editor schema:
 * `string` → `text`, `image` → `media`, `list` of scalars → `list` of the
 * mapped field, `group` on a block → `category`, `allowChildren` plus the
 * `structure` map → the `children` slot with `allow`/`disallow`. The root
 * always holds children. A property type the editor does not know throws an
 * `EditorAdapterError` of kind `validation`.
 */
export function fromCollection<const C extends AnyCollectionDefinition>(
  def: C,
): FromCollection<C>;
export function fromCollection(def: AnyCollectionDefinition): AnyEditorSchema {
  const components: Record<string, AnyComponentDef> = {};
  for (const [type, block] of Object.entries(def.blocks ?? {})) {
    const component: AnyComponentDef = {
      label: block.label,
      fields: fieldsFrom(block.properties),
    };
    if (block.description !== undefined) {
      component.description = block.description;
    }
    if (block.group !== undefined) component.category = block.group;
    if (block.previewImageUrl !== undefined) {
      component.previewImageUrl = block.previewImageUrl;
    }
    if (block.allowChildren === true) {
      component.slots = { [DEFAULT_SLOT]: childrenSlot(def, type) };
    }
    components[type] = component;
  }
  return {
    root: {
      label: def.label,
      fields: fieldsFrom(def.root.properties),
      slots: { [DEFAULT_SLOT]: childrenSlot(def, 'root') },
    },
    components,
  };
}

/** The createcms property specs of a node type (`'root'` for the root). */
function propertiesOfType(
  def: AnyCollectionDefinition,
  type: string,
): Record<string, BlockProperty> {
  if (type === 'root') return def.root.properties;
  return def.blocks?.[type]?.properties ?? {};
}

/** The keys a createcms asset reference may carry; the server rejects others. */
const MEDIA_KEYS = [
  'assetId',
  'alt',
  'decorative',
  'altSource',
  'caption',
  'revisionId',
  'crop',
  'focal',
] as const;

/** The known media keys of an object, without `undefined` entries. */
function mediaValue(value: Record<string, unknown>): MediaValue | undefined {
  if (typeof value.assetId !== 'string') return undefined;
  const out: Record<string, unknown> = {};
  for (const key of MEDIA_KEYS) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out as MediaValue;
}

/**
 * One createcms value in editor shape: an image id becomes `{ assetId }`, an
 * asset reference object keeps its known keys, a reference id becomes
 * `{ id }`.
 */
export function cmsValueToEditor(spec: BlockProperty, value: unknown): unknown {
  if (spec.type === 'image') {
    if (typeof value === 'string')
      return { assetId: value } satisfies MediaValue;
    if (isRecord(value)) return mediaValue(value) ?? value;
    return value;
  }
  if (spec.type === 'reference' && typeof value === 'string') {
    return { id: value } satisfies ReferenceValue;
  }
  if (spec.type === 'list' && Array.isArray(value)) {
    return value.map((item) =>
      cmsValueToEditor(spec.of as BlockProperty, item),
    );
  }
  return value;
}

/**
 * One editor value in createcms shape: media with only an `assetId` becomes
 * the bare id, media with settings an asset reference with the known keys
 * (list elements always store the bare id); `{ id }` becomes the id.
 */
export function editorValueToCms(spec: BlockProperty, value: unknown): unknown {
  return toCms(spec, value, false);
}

function toCms(spec: BlockProperty, value: unknown, element: boolean): unknown {
  if (spec.type === 'image' && isRecord(value)) {
    const media = mediaValue(value);
    if (!media) return value;
    const keys = Object.keys(media);
    if (element || (keys.length === 1 && keys[0] === 'assetId')) {
      return media.assetId;
    }
    return media;
  }
  if (spec.type === 'reference' && isRecord(value) && 'id' in value) {
    return value.id;
  }
  if (spec.type === 'list' && Array.isArray(value)) {
    return value.map((item) => toCms(spec.of as BlockProperty, item, true));
  }
  return value;
}

function mapProps(
  props: Record<string, unknown>,
  specs: Record<string, BlockProperty>,
  map: (spec: BlockProperty, value: unknown) => unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    const spec = specs[key];
    out[key] = spec ? map(spec, value) : value;
  }
  return out;
}

/**
 * A createcms tree (raw mode, as `getBlockTree` delivers it) as an editor
 * document: `blockId` → `id`, `properties` → `props` (values in editor
 * shape), `children` → the `children` slot. Keys the schema does not
 * declare (the root's `__slug`) are kept unchanged.
 */
export function toEditor(
  tree: BlockTreeNode,
  def: AnyCollectionDefinition,
): EditorDocument {
  const convert = (node: BlockTreeNode): NodeData => {
    const out: NodeData = {
      id: node.blockId,
      type: node.type,
      props: mapProps(
        node.properties,
        propertiesOfType(def, node.type),
        cmsValueToEditor,
      ) as Record<string, JsonValue>,
    };
    if (node.children.length > 0) {
      out.slots = { [DEFAULT_SLOT]: node.children.map(convert) };
    }
    return out;
  };
  return { schemaVersion: CMS_SCHEMA_VERSION, root: convert(tree) };
}

/**
 * An editor document as a createcms tree, the inverse of {@link toEditor}.
 * A slot other than `children` throws: createcms stores one child list.
 */
export function fromEditor(
  doc: EditorDocument,
  def: AnyCollectionDefinition,
): BlockTreeNode {
  return nodeToCms(doc.root, def);
}

/** One editor node (and its subtree) as a createcms tree node. */
export function nodeToCms(
  node: NodeData,
  def: AnyCollectionDefinition,
): BlockTreeNode {
  for (const slot of Object.keys(node.slots ?? {})) {
    if (slot !== DEFAULT_SLOT) {
      throw new EditorAdapterError(
        'validation',
        `fromEditor: node "${node.id}" uses slot "${slot}"; createcms stores the "${DEFAULT_SLOT}" slot only`,
        { nodeId: node.id, slot },
      );
    }
  }
  return {
    blockId: node.id,
    type: node.type,
    properties: mapProps(
      node.props,
      propertiesOfType(def, node.type),
      editorValueToCms,
    ),
    children: (node.slots?.[DEFAULT_SLOT] ?? []).map((child) =>
      nodeToCms(child, def),
    ),
  };
}

/** Props of one node in createcms shape. */
export function propsToCms(
  type: string,
  props: Record<string, unknown>,
  def: AnyCollectionDefinition,
): Record<string, unknown> {
  return mapProps(props, propertiesOfType(def, type), editorValueToCms);
}

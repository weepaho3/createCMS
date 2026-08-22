import type {
  AnyBlockDefinition,
  AnyCollectionDefinition,
  BlockProperty,
  CollectionDefinition,
  LinkValue,
} from '@createcms/schema';

/**
 * The editor's schema IS a createcms collection definition: same vocabulary
 * (`root`, `blocks`, `properties`, `structure`, `allowChildren`, `group`,
 * `defaultValue`), no adapter. Generic so the typed factory can carry the
 * concrete property/block maps; `AnyEditorSchema` is the wide form every
 * runtime helper in this package accepts.
 */
export type EditorSchema<
  TProps extends Record<string, BlockProperty> = Record<string, BlockProperty>,
  TBlocks extends Record<string, AnyBlockDefinition> = Record<
    string,
    AnyBlockDefinition
  >,
> = CollectionDefinition<TProps, TBlocks>;

export type AnyEditorSchema = AnyCollectionDefinition;

/**
 * Wide runtime value per field kind: the closed union the headless controls
 * are typed against. `select` narrows to its option union and `list` to its
 * element type only through the typed factory hooks (same derivation as
 * `InferBlockProperties`; `schema.type-check.ts` pins both to each other).
 * `date` is an ISO-8601 datetime string, `image` an asset id, `reference` a
 * root id, `link` the authored `LinkValue` (raw mode, never resolved).
 */
export type FieldValueMap = {
  string: string;
  number: number;
  boolean: boolean;
  date: string;
  richText: string;
  image: string;
  select: string;
  reference: string;
  link: LinkValue;
  list: Array<string | number | boolean>;
};

/** Every kind a block or root property can have: `BlockPropertyType` plus `list`. */
export type FieldKind = keyof FieldValueMap;

/** The spec of one kind (`FieldSpecOf<'select'>` carries `options`, …). */
export type FieldSpecOf<K extends FieldKind> = Extract<
  BlockProperty,
  { type: K }
>;

/** The wide runtime value of one kind. */
export type FieldValueOf<K extends FieldKind> = FieldValueMap[K];

/** One property of a block or the root: its key and its spec. */
export type SchemaField = {
  readonly key: string;
  readonly spec: BlockProperty;
};

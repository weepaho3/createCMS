import type { AnyCollectionDefinition } from './collection';
import type {
  LinkKind,
  LinkValue,
  ResolvedLink,
  ResolvedReference,
} from './references';

// ============================================================================
// Block Property Types
// ============================================================================

type BlockTypes = {
  string: string;
  number: number;
  boolean: boolean;
  date: string;
  richText: string;
  // An image is the asset's id STRING on both write and read paths; it is
  // served via the id-addressed gate `/media/asset/{id}` and nothing is
  // resolved at read time (a slug swap behind the id propagates automatically).
  image: string;
  select: string;
  // The AUTHORED value of a reference is the target's rootId STRING, inlined
  // to a `ResolvedReference` only on the published read path (the `resolved`
  // inference mode); write input + the editor read keep the string.
  reference: string;
  // The AUTHORED value of a link is a `LinkValue` union; it resolves to a
  // `ResolvedLink` (an href) only on the read path (the `resolved` mode).
  link: LinkValue;
};

/** Reference inference mode: `raw` (write input + getBlockTree editor read) keeps
 *  a `reference` as its stored rootId string; `resolved` (getPublishedContent)
 *  surfaces the inlined `ResolvedReference`. */
export type RefMode = 'raw' | 'resolved';

export type BlockPropertyType = keyof BlockTypes;

// ============================================================================
// Blocks
// ============================================================================

export type SelectOption = { readonly label: string; readonly value: string };

/**
 * Declarative length/format constraints for text-like properties (`string`,
 * `richText`) and list elements of those types. Honoured by the zod builder
 * (`buildPropertiesSchema`): `minLength`/`maxLength` bound the string length
 * and `pattern` is a JS regex SOURCE string the value must match.
 */
export type StringConstraints = {
  minLength?: number;
  maxLength?: number;
  /** A JS `RegExp` SOURCE string the value must match (e.g. `'^[a-z]+$'`). */
  pattern?: string;
};

/** Declarative range constraints for `number` properties / list elements. */
export type NumberConstraints = {
  min?: number;
  max?: number;
};

type BlockPropertySpec<T extends BlockPropertyType> = {
  type: T;
  required?: boolean;
  defaultValue?: BlockTypes[T];

  label: string;
  description?: string;
  placeholder?: string;
  /**
   * Editor hint: the field-group (fieldset/section) this property is shown
   * under in the property panel (e.g. `'SEO'`, `'Layout'`). Purely
   * presentational, the editor groups fields by this label and the package
   * never acts on it. Free-form by design; for consistent, autocompleted group
   * names across fields, reference a shared `as const` object (e.g.
   * `group: FIELD_GROUPS.seo`).
   */
  group?: string;
} & (T extends 'select' ? { options: readonly SelectOption[] } : {}) &
  (T extends 'reference' ? { collection: string } : {}) &
  // Declarative zod-level constraints: text length/format on string/richText,
  // numeric range on number. Honoured by buildPropertiesSchema.
  (T extends 'string' | 'richText' ? StringConstraints : {}) &
  (T extends 'number' ? NumberConstraints : {}) &
  (T extends 'link'
    ? {
        allowedKinds?: readonly LinkKind[];
        allowedCollections?: readonly string[];
      }
    : {});

/**
 * Element kinds a {@link ListBlockPropertySpec} may hold: every single-value
 * property type EXCEPT `link` (links are not list-able). A `reference` element
 * makes the list a MULTI-REFERENCE.
 */
export type ListElementType = Exclude<BlockPropertyType, 'link'>;

/**
 * One element descriptor of a `list` property. Mirrors the single-value specs:
 * a `select` element carries its `options`, a `reference` element its target
 * `collection`, and text/number elements may carry the same declarative
 * constraints as their scalar counterparts. Each array item is validated against
 * this by the array schema.
 */
export type ListElementSpec = {
  [K in ListElementType]: { type: K } & (K extends 'select'
    ? { options: readonly SelectOption[] }
    : {}) &
    (K extends 'reference' ? { collection: string } : {}) &
    (K extends 'string' | 'richText' ? StringConstraints : {}) &
    (K extends 'number' ? NumberConstraints : {});
}[ListElementType];

/**
 * A `list` property: an ordered JSON array whose every element matches `of`
 * (a scalar OR a `reference`). A list OF `reference` is a MULTI-REFERENCE:
 * its elements are walked by the reference/usage extraction machinery exactly
 * like a single `reference`. `min`/`max` bound the array LENGTH (honoured by
 * the zod builder). Nested-object elements and structure cardinality are
 * intentionally out of scope.
 */
export type ListBlockPropertySpec = {
  type: 'list';
  of: ListElementSpec;
  required?: boolean;
  min?: number;
  max?: number;

  label: string;
  description?: string;
  placeholder?: string;
  /** Editor field-group hint, see {@link BlockPropertySpec}. */
  group?: string;
};

/** Discriminated union over all concrete block-property specs. */
export type BlockProperty =
  | {
      [K in BlockPropertyType]: BlockPropertySpec<K>;
    }[BlockPropertyType]
  | ListBlockPropertySpec;

type Simplify<T> = { [K in keyof T]: T[K] };

/** Extracts the runtime value type of ONE {@link ListElementSpec}: the same
 *  select/reference/scalar logic as {@link InferPropertyValue}, but for a list's
 *  element. A `reference` element is a rootId string in `raw` mode and a
 *  `ResolvedReference` in `resolved` mode (bounded to depth 1, like single refs). */
type InferElementValue<
  E extends ListElementSpec,
  M extends RefMode = 'raw',
  TCol extends Record<string, AnyCollectionDefinition> = {},
> = E extends {
  type: 'select';
  options: readonly { readonly value: infer V extends string }[];
}
  ? V
  : E extends { type: 'reference'; collection: infer C extends string }
    ? M extends 'resolved'
      ? C extends keyof TCol
        ? ResolvedReference<
            NonNullable<
              InferBlockProperties<TCol[C]['root']['properties'], 'resolved'>
            >
          >
        : ResolvedReference
      : string
    : E extends { type: infer ET extends keyof BlockTypes }
      ? BlockTypes[ET]
      : never;

/** Extracts the runtime value type for a block property.
 *  For `select` properties with options, returns the union of option values.
 *  A `reference` is a rootId string in `raw` mode (write input + editor read) and
 *  a `ResolvedReference` in `resolved` mode (published read).
 *  A `list` becomes an ARRAY of its element's inferred value (a list of
 *  `reference` gives `string[]` raw / `ResolvedReference[]` resolved).
 *  For all other types, returns the corresponding primitive type. */
type InferPropertyValue<
  T extends BlockProperty,
  M extends RefMode = 'raw',
  TCol extends Record<string, AnyCollectionDefinition> = {},
> = T extends { type: 'list'; of: infer E extends ListElementSpec }
  ? InferElementValue<E, M, TCol>[]
  : T extends {
        type: 'select';
        options: readonly { readonly value: infer V extends string }[];
      }
    ? V
    : T extends { type: 'reference'; collection: infer C extends string }
      ? M extends 'resolved'
        ? // Resolved read: a reference is the inlined target. When the target
          // collection is in the threaded map, its `properties` are typed from
          // the target's root definition. Nested references inside the target
          // stay UNTYPED (the inner InferBlockProperties defaults TCol to
          // `{}`), which bounds resolution to depth 1 and avoids cyclic-
          // reference type blowup.
          C extends keyof TCol
          ? ResolvedReference<
              NonNullable<
                InferBlockProperties<TCol[C]['root']['properties'], 'resolved'>
              >
            >
          : ResolvedReference
        : string
      : T extends { type: 'link' }
        ? // A link is the stored `LinkValue` in `raw` mode (write input +
          // editor read) and a `ResolvedLink` (an href) on the `resolved`
          // read path.
          M extends 'resolved'
          ? ResolvedLink
          : LinkValue
        : // `image` is the asset-id string in BOTH modes (served via the
          // id-addressed gate; nothing is resolved at read time). Intersecting
          // with `keyof BlockTypes` keeps this a direct indexed access (no
          // extra deferred conditional) while excluding the non-scalar 'list'
          // tag, which the branches above have already handled.
          BlockTypes[T['type'] & keyof BlockTypes];

type RequiredPart<
  T extends Record<string, BlockProperty>,
  M extends RefMode,
  TCol extends Record<string, AnyCollectionDefinition>,
> = {
  [K in keyof T as T[K] extends { required: true }
    ? K
    : never]: InferPropertyValue<T[K], M, TCol>;
};

type OptionalPart<
  T extends Record<string, BlockProperty>,
  M extends RefMode,
  TCol extends Record<string, AnyCollectionDefinition>,
> = {
  [K in keyof T as T[K] extends { required: true }
    ? never
    : K]?: InferPropertyValue<T[K], M, TCol>;
};

export type HasRequiredKeys<T extends Record<string, BlockProperty>> =
  true extends {
    [K in keyof T]: T[K] extends { required: true } ? true : never;
  }[keyof T]
    ? true
    : false;

/** Maps a properties record to its runtime value types, respecting `required`.
 *  When all properties are optional, the entire input becomes optional (| undefined). */
export type InferBlockProperties<
  T extends Record<string, BlockProperty>,
  M extends RefMode = 'raw',
  TCol extends Record<string, AnyCollectionDefinition> = {},
> =
  HasRequiredKeys<T> extends true
    ? Simplify<RequiredPart<T, M, TCol> & OptionalPart<T, M, TCol>>
    : Simplify<RequiredPart<T, M, TCol> & OptionalPart<T, M, TCol>> | undefined;

/** Partial properties variant for updates (PATCH semantics): every key is
 *  optional; setting a key to a value overwrites it, setting it to `null`
 *  deletes it, and omitting it leaves it unchanged. */
export type InferPartialBlockProperties<
  T extends Record<string, BlockProperty>,
> = Simplify<{ [K in keyof T]?: InferPropertyValue<T[K]> | null }>;

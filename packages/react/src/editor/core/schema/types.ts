import type { JsonValue, NodeData } from '../document';
import type { StandardSchemaV1 } from './standard-schema';

/** The kinds a `link` field can point at. */
export type LinkKind = 'internal' | 'external' | 'email' | 'phone';

/**
 * The authored value of a `link` field. An `internal` link stores the
 * target's id and collection; the other kinds store their literal target.
 */
export type LinkValue =
  | {
      kind: 'internal';
      rootId: string;
      collection: string;
      fragment?: string;
      query?: string;
    }
  | { kind: 'external'; url: string }
  | { kind: 'email'; email: string }
  | { kind: 'phone'; phone: string };

/** A crop rectangle in fractions of the image (0 to 1). */
export type MediaCrop = { x: number; y: number; width: number; height: number };

/** A focal point in fractions of the image (0 to 1). */
export type MediaFocalPoint = { x: number; y: number };

/**
 * The value of a `media` field: an asset id plus optional presentation
 * settings for this use of the asset.
 */
export type MediaValue = {
  assetId: string;
  alt?: string;
  /** The image is decorative; renderers write `alt=""`. */
  decorative?: boolean;
  altSource?: 'user' | 'ai-suggested';
  caption?: string;
  /** Pins one revision of the asset. */
  revisionId?: string;
  crop?: MediaCrop;
  focal?: MediaFocalPoint;
};

/** The value of a `reference` field: the id of the referenced document. */
export type ReferenceValue = { id: string };

/** One choice of a `select` field. */
export type SelectOption = { readonly label: string; readonly value: string };

/** What `hidden` predicates and `resolveFields` receive besides the props. */
export type FieldContext = {
  /** Id of the node whose fields are evaluated. */
  readonly nodeId: string;
  /** Component type of that node (`'root'` for the root). */
  readonly type: string;
  /** Values ancestors expose through `providesContext`, keyed by context name. */
  readonly context: Readonly<Record<string, unknown>>;
  /** The schema's `metadata`. */
  readonly metadata: Readonly<Record<string, JsonValue>>;
};

/** Settings every field kind shares. `V` is the field's value type. */
export type FieldBase<V> = {
  /** Shown next to the control; the field key is the fallback. */
  label?: string;
  description?: string;
  placeholder?: string;
  /** Fields with the same `group` render together. */
  group?: string;
  required?: boolean;
  /** Seeded into a newly inserted node. */
  defaultValue?: V;
  /** Shown but not editable in the form, the canvas or inline. */
  readOnly?: boolean;
  /** The value may be a `{ $l: { [locale]: V } }` wrapper. */
  localized?: boolean;
  /** The value may be a `{ $r: { base: V, sm?, md?, lg?, xl? } }` wrapper. */
  responsive?: boolean;
  /** Hides the field always (`true`) or when the predicate returns `true`. */
  hidden?:
    | boolean
    | ((props: Record<string, unknown>, ctx: FieldContext) => boolean);
  /** JSON-only condition: the field is shown when `props[field] === eq`. */
  when?: { field: string; eq: JsonValue };
  /** Extra validation through any Standard Schema library. */
  validate?: StandardSchemaV1;
  /**
   * Rewrites node ids inside this field's value when a subtree is copied
   * (duplicate, paste, template insert); `map` holds old id to new id.
   */
  rewriteRefs?(value: V, map: ReadonlyMap<string, string>): V;
};

/** Length and pattern rules for text-like values. */
export type TextConstraints = {
  minLength?: number;
  maxLength?: number;
  /** A regular expression source the whole value must match. */
  pattern?: string;
};

/**
 * Single-line text.
 * @example { type: 'text', label: 'Title', required: true, maxLength: 80 }
 */
export type TextField = {
  type: 'text';
  /**
   * How the canvas edits the value in place: `glass` (default) overlays an
   * editable copy, `in-place` edits the rendered element itself (for
   * gradients, balanced wrapping, transforms; see `useEditableField`),
   * `false` keeps it form-only.
   */
  inline?: 'glass' | 'in-place' | false;
} & TextConstraints &
  FieldBase<string>;

/**
 * Multi-line plain text.
 * @example { type: 'textarea', label: 'Summary' }
 */
export type TextareaField = { type: 'textarea' } & TextConstraints &
  FieldBase<string>;

/**
 * A finite number.
 * @example { type: 'number', label: 'Columns', min: 1, max: 4, step: 1 }
 */
export type NumberField = {
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
} & FieldBase<number>;

/**
 * True or false.
 * @example { type: 'boolean', label: 'Show border' }
 */
export type BooleanField = { type: 'boolean' } & FieldBase<boolean>;

/**
 * One option, or with `multiple` a list of options.
 * @example { type: 'select', label: 'Align', options: [{ label: 'Left', value: 'left' }] }
 */
export type SelectField = {
  type: 'select';
  options: readonly SelectOption[];
  multiple?: boolean;
} & FieldBase<string | string[]>;

/**
 * An ISO-8601 datetime in UTC.
 * @example { type: 'date', label: 'Published at' }
 */
export type DateField = { type: 'date' } & FieldBase<string>;

/**
 * A CSS color string.
 * @example { type: 'color', label: 'Background' }
 */
export type ColorField = { type: 'color' } & FieldBase<string>;

/**
 * Formatted text. `marks` and `nodes` restrict the formatting the editor
 * offers; `inline` limits the value to a single paragraph.
 * @example { type: 'richText', label: 'Body', marks: ['bold', 'italic', 'link'] }
 */
export type RichTextField = {
  type: 'richText';
  marks?: readonly string[];
  nodes?: readonly string[];
  inline?: boolean;
} & TextConstraints &
  FieldBase<string>;

/**
 * An asset from the media library.
 * @example { type: 'media', label: 'Image', accept: ['image/*'] }
 */
export type MediaField = {
  type: 'media';
  /** MIME types or `type/*` patterns the picker offers. */
  accept?: readonly string[];
} & FieldBase<MediaValue>;

/**
 * A link to a document, a URL, an email address or a phone number.
 * @example { type: 'link', label: 'Target', allowedKinds: ['internal', 'external'] }
 */
export type LinkField = {
  type: 'link';
  allowedKinds?: readonly LinkKind[];
  allowedCollections?: readonly string[];
} & FieldBase<LinkValue>;

/**
 * Another document of `collection`.
 * @example { type: 'reference', label: 'Author', collection: 'authors' }
 */
export type ReferenceField = {
  type: 'reference';
  collection: string;
} & FieldBase<ReferenceValue>;

/**
 * An ordered list of values of the field `of`.
 * @example { type: 'list', label: 'Tags', of: { type: 'text' }, max: 10 }
 */
export type ListField = {
  type: 'list';
  of: Field;
  min?: number;
  max?: number;
  /** A field key of an `object` element, shown as each item's label. */
  itemLabel?: string;
} & FieldBase<unknown[]>;

/**
 * A group of named fields stored as one object value.
 * @example { type: 'object', label: 'CTA', fields: { label: { type: 'text' }, link: { type: 'link' } } }
 */
export type ObjectField = {
  type: 'object';
  fields: Record<string, Field>;
} & FieldBase<Record<string, unknown>>;

/**
 * A value whose control the application registers under `kind`.
 * @example { type: 'custom', kind: 'icon-picker', label: 'Icon' }
 */
export type CustomField = {
  type: 'custom';
  kind: string;
  schema?: StandardSchemaV1;
} & FieldBase<unknown>;

/** Every field a component can declare. */
export type Field =
  | TextField
  | TextareaField
  | NumberField
  | BooleanField
  | SelectField
  | DateField
  | ColorField
  | RichTextField
  | MediaField
  | LinkField
  | ReferenceField
  | ListField
  | ObjectField
  | CustomField;

/** Wide runtime value per field kind. */
export type FieldValueMap = {
  text: string;
  textarea: string;
  number: number;
  boolean: boolean;
  select: string | string[];
  date: string;
  color: string;
  richText: string;
  media: MediaValue;
  link: LinkValue;
  reference: ReferenceValue;
  list: unknown[];
  object: Record<string, unknown>;
  custom: unknown;
};

/** Every field kind. */
export type FieldKind = Field['type'];

/** The field type of one kind (`FieldSpecOf<'select'>` carries `options`, ...). */
export type FieldSpecOf<K extends FieldKind> = Extract<Field, { type: K }>;

/** The wide runtime value of one kind. */
export type FieldValueOf<K extends FieldKind> = FieldValueMap[K];

/** One field of a component: its key and its definition. */
export type SchemaField = {
  readonly key: string;
  readonly spec: Field;
};

/** A responsive value: `base` plus mobile-first overrides per breakpoint. */
export type Responsive<V> =
  | V
  | { $r: { base: V } & Partial<Record<Breakpoint, V>> };

/** The breakpoints a responsive value can override, smallest first. */
export type Breakpoint = 'sm' | 'md' | 'lg' | 'xl';

/** A localized value: one entry per locale. */
export type Localized<V> = V | { $l: Partial<Record<string, V>> };

type Simplify<T> = { [K in keyof T]: T[K] };

type BaseValue<F> = F extends {
  type: 'select';
  multiple: true;
  options: readonly { readonly value: infer V extends string }[];
}
  ? V[]
  : F extends {
        type: 'select';
        options: readonly { readonly value: infer V extends string }[];
      }
    ? V
    : F extends { type: 'list'; of: infer E }
      ? FieldValue<E>[]
      : F extends {
            type: 'object';
            fields: infer S extends Record<string, Field>;
          }
        ? InferProps<S>
        : F extends {
              type: 'custom';
              schema: StandardSchemaV1<unknown, infer O>;
            }
          ? O
          : F extends { type: infer K extends FieldKind }
            ? FieldValueMap[K]
            : never;

type WithWrappers<F, V> = F extends { responsive: true }
  ? F extends { localized: true }
    ? Localized<Responsive<V>>
    : Responsive<V>
  : F extends { localized: true }
    ? Localized<V>
    : V;

/** The value type of one field definition. */
export type FieldValue<F> = WithWrappers<F, BaseValue<F>>;

/**
 * The props object a component with these fields receives: `required` fields
 * are required keys, every other field is optional. `select` narrows to its
 * option values, `list` to its element type, `object` to its nested props.
 */
export type InferProps<F extends Record<string, Field>> = Simplify<
  {
    -readonly [K in keyof F as F[K] extends { required: true }
      ? K
      : never]: FieldValue<F[K]>;
  } & {
    -readonly [K in keyof F as F[K] extends { required: true }
      ? never
      : K]?: FieldValue<F[K]>;
  }
>;

/** A node to create: a type plus optional props and slot contents. */
export type NodeInput = {
  type: string;
  props?: Record<string, JsonValue>;
  slots?: Record<string, NodeInput[]>;
};

/** What a slot's `accept` predicate receives. */
export type PlaceContext = {
  readonly childType: string;
  readonly parentId: string;
  readonly parentType: string;
  readonly slot: string;
};

/**
 * One named slot of a component. `allow` wins over `disallow`; `min`/`max`
 * warn while editing and block publishing.
 */
export type SlotSpec = {
  label?: string;
  allow?: readonly string[];
  disallow?: readonly string[];
  min?: number;
  max?: number;
  /** Nodes seeded into the slot when the component is inserted. */
  defaultValue?: readonly NodeInput[];
  accept?(ctx: PlaceContext): boolean;
};

/** Structural actions a component can switch off. */
export type ComponentPermission =
  | 'drag'
  | 'duplicate'
  | 'delete'
  | 'edit'
  | 'insert';

/** Why `resolveData` runs and what changed. */
export type ResolveDataContext = {
  readonly trigger: 'load' | 'insert' | 'change' | 'force';
  /** For `change`: the prop keys the edit wrote. */
  readonly changed: Readonly<Record<string, true>>;
  readonly signal: AbortSignal;
  readonly metadata: Readonly<Record<string, JsonValue>>;
};

/** One step of a component's migration chain, run before validation. */
export type Migration = {
  /** The component version this step produces; ids start at 1. */
  to: number;
  up(
    props: Record<string, JsonValue>,
    ctx: { node: NodeData },
  ):
    | Record<string, JsonValue>
    | {
        props: Record<string, JsonValue>;
        slots?: Record<string, NodeData[]>;
        type?: string;
      };
  down?(props: Record<string, JsonValue>): Record<string, JsonValue>;
};

/**
 * One component of an editor schema: its fields, its slots and how the editor
 * treats it. Everything but the functions is plain data, so a schema can be
 * read on a server.
 */
export type ComponentDef<
  F extends Record<string, Field> = Record<string, Field>,
  S extends Record<string, SlotSpec> = Record<string, SlotSpec>,
> = {
  label: string;
  description?: string;
  /** Palette category. */
  category?: string;
  /** Icon name the application maps to a glyph. */
  icon?: string;
  previewImageUrl?: string;
  /** Current component version; nodes with a lower `v` run `migrations`. */
  version?: number;
  fields: F;
  /** Named slots; `children` is the default slot. */
  slots?: S;
  /** The component's renderer; typed by the rendering layer. */
  render?: unknown;
  /**
   * Props a page may override where this component appears inside a
   * reusable section (`$ref`); every other prop stays as the section has it.
   */
  exposedProps?: readonly (keyof F & string)[];
  resolveFields?(
    data: { props: InferProps<F> },
    ctx: FieldContext,
  ): { [K in keyof F]?: Partial<Field> };
  /**
   * Computes display values from the props (a fetched title, a price). The
   * result lives in the session (`computed`), never in the document; a newer
   * call aborts an older one through `ctx.signal`.
   */
  resolveData?(
    data: { id: string; props: InferProps<F> },
    ctx: ResolveDataContext,
  ): Record<string, JsonValue> | Promise<Record<string, JsonValue>>;
  migrations?: readonly Migration[];
  /** Extra validation of the whole props object through any Standard Schema library. */
  validate?: StandardSchemaV1;
  /** `false` switches an action off for every node of this component. */
  permissions?: Partial<Record<ComponentPermission, boolean>> &
    Record<string, boolean | undefined>;
  /** Context names this component exposes to descendants, mapped to one of its field keys. */
  providesContext?: Readonly<Record<string, Extract<keyof F, string>>>;
  /** Context names this component reads from its ancestors. */
  usesContext?: readonly string[];
};

/** The wide component form every runtime helper accepts. */
export type AnyComponentDef = ComponentDef;

/** The editor's schema: the root, every insertable component and global rules. */
export type EditorSchema<
  R extends AnyComponentDef = AnyComponentDef,
  C extends Record<string, AnyComponentDef> = Record<string, AnyComponentDef>,
> = {
  root: R;
  components: C;
  /** Global placement rule, checked after the slot rules. */
  canPlace?(childType: string, parentType: string, slot: string): boolean;
  /** Old component type names mapped to their current name. */
  aliases?: Readonly<Record<string, string>>;
  /** Values every `hidden`, `resolveFields` and `accept` call can read. */
  metadata?: Readonly<Record<string, JsonValue>>;
};

/** The wide schema form every runtime helper accepts. */
export type AnyEditorSchema = EditorSchema;

/** Declares a component with its props inferred from `fields`. */
export function defineComponent<
  const F extends Record<string, Field>,
  const S extends Record<string, SlotSpec> = Record<never, SlotSpec>,
>(component: ComponentDef<F, S>): ComponentDef<F, S> {
  return component;
}

/** Declares an editor schema and keeps its literal types for the typed factory. */
export function defineEditorSchema<const S extends AnyEditorSchema>(
  schema: S,
): S {
  return schema;
}

import * as z from 'zod';

import type {
  AnyBlockDefinition,
  BlockProperty,
  InferBlockProperties,
  InferCreateBlockInput,
  InferMergeBlockVersionInput,
  InferPartialBlockProperties,
  InferUpdateBlockInput,
  LinkKind,
  ListElementSpec,
} from './types';

const ALL_LINK_KINDS: readonly LinkKind[] = [
  'internal',
  'external',
  'email',
  'phone',
];

function linkKindSchema(
  kind: LinkKind,
  allowedCollections?: readonly string[],
): z.ZodType {
  switch (kind) {
    case 'internal':
      return z.object({
        kind: z.literal('internal'),
        rootId: z.string().trim().min(1),
        // Constrain the target collection to the allowed set when configured.
        collection: allowedCollections?.length
          ? z.enum(allowedCollections as [string, ...string[]])
          : z.string(),
        fragment: z.string().optional(),
        query: z.string().optional(),
      });
    case 'external':
      return z.object({
        kind: z.literal('external'),
        url: z.string().trim().min(1),
      });
    case 'email':
      return z.object({
        kind: z.literal('email'),
        email: z.string().trim().min(1),
      });
    case 'phone':
      return z.object({
        kind: z.literal('phone'),
        phone: z.string().trim().min(1),
      });
  }
}

/** A `link` value validator: a discriminated union over `kind`, restricted to
 *  `allowedKinds` (default: all) — and, for internal links, to
 *  `allowedCollections` (default: any collection). */
function buildLinkSchema(
  allowedKinds?: readonly LinkKind[],
  allowedCollections?: readonly string[],
): z.ZodType {
  const kinds = allowedKinds?.length ? allowedKinds : ALL_LINK_KINDS;
  const members = kinds.map((k) => linkKindSchema(k, allowedCollections)) as [
    z.ZodType,
    ...z.ZodType[],
  ];
  return z.discriminatedUnion(
    'kind',
    members as unknown as [z.ZodObject, ...z.ZodObject[]],
  );
}

/**
 * Zod for a scalar / reference property (or list element) of the given `spec`,
 * honouring the declarative constraints on it (cms-04):
 * - `string` / `richText` → `z.string()` with `minLength`/`maxLength`/`pattern`
 * - `number` → `z.number()` with `min`/`max`
 * - `date` → ISO-8601 datetime string (`z.iso.datetime()`)
 * - `boolean` → `z.boolean()`; `image` / `reference` → `z.string()`
 *
 * Typed loosely because it serves BOTH top-level property specs and list element
 * specs (both carry `type` plus the optional constraint fields).
 */
function scalarSchema(spec: {
  type: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  min?: number;
  max?: number;
}): z.ZodType {
  switch (spec.type) {
    case 'string':
    case 'richText': {
      let s = z.string();
      if (typeof spec.minLength === 'number') s = s.min(spec.minLength);
      if (typeof spec.maxLength === 'number') s = s.max(spec.maxLength);
      if (typeof spec.pattern === 'string') s = s.regex(new RegExp(spec.pattern));
      return s;
    }
    case 'number': {
      let n = z.number();
      if (typeof spec.min === 'number') n = n.min(spec.min);
      if (typeof spec.max === 'number') n = n.max(spec.max);
      return n;
    }
    case 'boolean':
      return z.boolean();
    case 'date':
      // ISO-8601 datetime (e.g. `2024-01-01T00:00:00Z`), not a bare string.
      return z.iso.datetime();
    // `image` and `reference` are id / rootId strings.
    default:
      return z.string();
  }
}

/** Zod for one {@link ListElementSpec}: a `select` element enumerates its
 *  options; every other element reuses {@link scalarSchema} (a `reference`
 *  element validates as the rootId string). */
function elementSchema(el: ListElementSpec): z.ZodType {
  if (el.type === 'select') {
    return z.enum(el.options.map((o) => o.value) as [string, ...string[]]);
  }
  return scalarSchema(el);
}

export function buildPropertiesSchema<T extends Record<string, BlockProperty>>(
  properties: T,
  allOptional?: boolean,
): z.ZodType<InferBlockProperties<T>> {
  const shape: Record<string, z.ZodType> = {};
  let hasRequired = false;
  for (const [key, prop] of Object.entries(properties)) {
    let field: z.ZodType;

    if (prop.type === 'list') {
      // A list is a JSON array of its element schema, bounded by min/max LENGTH.
      let arr = z.array(elementSchema(prop.of));
      if (typeof prop.min === 'number') arr = arr.min(prop.min);
      if (typeof prop.max === 'number') arr = arr.max(prop.max);
      field = arr;
    } else if (prop.type === 'select') {
      const values = prop.options.map((o) => o.value);
      field = z.enum(values as [string, ...string[]]);
    } else if (prop.type === 'link') {
      field = buildLinkSchema(prop.allowedKinds, prop.allowedCollections);
    } else {
      field = scalarSchema(prop);
    }

    if (allOptional) {
      // Update (PATCH): a key may carry a value, be `null` (delete it), or be
      // omitted (leave it unchanged).
      shape[key] = field.nullable().optional();
    } else if (prop.required === true) {
      hasRequired = true;
      shape[key] = field;
    } else {
      shape[key] = field.optional();
    }
  }
  const schema = z.object(shape);
  if (allOptional) return schema as any;
  return (hasRequired ? schema : schema.optional()) as any;
}

export type RootInput<T extends Record<string, BlockProperty>> = {
  properties: InferBlockProperties<T>;
  slug?: string;
  message?: string;
  parentRootId?: string;
};

export function buildRootInputSchema<T extends Record<string, BlockProperty>>(
  properties: T,
): z.ZodType<RootInput<T>> {
  return z.object({
    slug: z.string().optional(),
    message: z.string().optional(),
    parentRootId: z.string().optional(),
    properties: buildPropertiesSchema(properties) as z.ZodType,
  }) as any;
}

// ============================================================================
// Block Input Schemas (create / update)
// ============================================================================

export function buildBlockInputSchema<
  TBlocks extends Record<string, AnyBlockDefinition>,
>(blocks: TBlocks): z.ZodType<InferCreateBlockInput<TBlocks>> {
  const variants = Object.entries(blocks).map(([name, blockDef]) =>
    z.object({
      rootId: z.string(),
      branchId: z.string(),
      parentBlockId: z.string(),
      position: z.number().optional(),
      message: z.string().optional(),
      // Optimistic-concurrency guard (cms-18); enforced in the blocks route.
      expectedHeadCommitId: z.string().optional(),
      type: z.literal(name),
      properties: buildPropertiesSchema(blockDef.properties) as z.ZodType,
    }),
  );
  if (variants.length === 0) return z.never() as any;
  if (variants.length === 1) return variants[0] as any;
  return z.union(
    variants as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]],
  ) as any;
}

export function buildUpdateBlockInputSchema<
  TBlocks extends Record<string, AnyBlockDefinition>,
>(blocks: TBlocks): z.ZodType<InferUpdateBlockInput<TBlocks>> {
  const variants = Object.entries(blocks).map(([name, blockDef]) =>
    z.object({
      rootId: z.string(),
      branchId: z.string(),
      blockId: z.string(),
      message: z.string().optional(),
      // Optimistic-concurrency guard (cms-18); enforced in the blocks route.
      expectedHeadCommitId: z.string().optional(),
      type: z.literal(name),
      properties: buildPropertiesSchema(blockDef.properties, true) as z.ZodType,
    }),
  );
  if (variants.length === 0) return z.never() as any;
  if (variants.length === 1) return variants[0] as any;
  return z.union(
    variants as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]],
  ) as any;
}

export function buildMergeBlockVersionInputSchema<
  TBlocks extends Record<string, AnyBlockDefinition>,
  TRootProps extends Record<string, BlockProperty>,
>(
  blocks: TBlocks,
  rootProperties: TRootProps,
): z.ZodType<InferMergeBlockVersionInput<TBlocks, TRootProps>> {
  const base = {
    mergeRequestId: z.string(),
    blockId: z.string(),
    children: z.array(z.string()).optional(),
  };

  const childVariants = Object.entries(blocks).map(([name, blockDef]) =>
    z.object({
      ...base,
      type: z.literal(name),
      properties: buildPropertiesSchema(blockDef.properties) as z.ZodType,
    }),
  );

  const rootVariant = z.object({
    ...base,
    type: z.literal('root' as const),
    properties: buildPropertiesSchema(rootProperties) as z.ZodType,
  });

  const variants = [...childVariants, rootVariant];
  if (variants.length === 1) return variants[0] as any;
  return z.union(
    variants as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]],
  ) as any;
}

export type UpdateRootInput<T extends Record<string, BlockProperty>> = {
  rootId: string;
  branchId: string;
  slug?: string;
  message?: string;
  /** Optimistic-concurrency guard (cms-18); enforced in the blocks route. */
  expectedHeadCommitId?: string;
  properties: InferPartialBlockProperties<T>;
};

export function buildUpdateRootInputSchema<
  T extends Record<string, BlockProperty>,
>(properties: T): z.ZodType<UpdateRootInput<T>> {
  return z.object({
    rootId: z.string(),
    branchId: z.string(),
    slug: z.string().optional(),
    message: z.string().optional(),
    // Optimistic-concurrency guard (cms-18); enforced in the blocks route.
    expectedHeadCommitId: z.string().optional(),
    properties: buildPropertiesSchema(properties, true) as z.ZodType,
  }) as any;
}

// ============================================================================
// List Roots Query Schema
// ============================================================================

export const ROOT_COLUMN_FIELDS = [
  'rootId',
  'slug',
  'createdAt',
  'createdBy',
] as const;
export type RootColumnField = (typeof ROOT_COLUMN_FIELDS)[number];

export type ListRootsField<T extends Record<string, BlockProperty>> =
  | Extract<keyof T, string>
  | RootColumnField;

export type ListRootsQuery<
  T extends Record<string, BlockProperty> = Record<string, BlockProperty>,
> = {
  limit?: number;
  offset?: number;
  search?: string;
  searchField?: ListRootsField<T>;
  sortBy?: ListRootsField<T>;
  sortDirection?: 'asc' | 'desc';
  filterField?: ListRootsField<T>;
  filterValue?: string;
  hasPublications?: boolean;
  createdAfter?: Date;
  createdBefore?: Date;
  /** Filter by parent: string = children of that root, 'null' = top-level only, omitted = all */
  parentRootId?: string;
};

export function buildListRootsQuerySchema<
  T extends Record<string, BlockProperty>,
>(properties: T) {
  const propertyKeys = Object.keys(properties);
  const fieldValues = [...ROOT_COLUMN_FIELDS, ...propertyKeys] as [
    string,
    ...string[],
  ];

  const fieldEnum = z.enum(fieldValues);

  return z
    .object({
      limit: z.coerce.number().min(1).max(100).optional(),
      offset: z.coerce.number().min(0).optional(),
      search: z.string().optional(),
      searchField: fieldEnum.optional(),
      sortBy: fieldEnum.optional(),
      sortDirection: z.enum(['asc', 'desc']).optional(),
      filterField: fieldEnum.optional(),
      filterValue: z.string().optional(),
      hasPublications: z.coerce.boolean().optional(),
      createdAfter: z.coerce.date().optional(),
      createdBefore: z.coerce.date().optional(),
      parentRootId: z.string().optional(),
    })
    .optional() as z.ZodType<ListRootsQuery<T> | undefined>;
}

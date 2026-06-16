import * as z from 'zod';

import type {
  AnyBlockDefinition,
  BlockProperty,
  BlockPropertyType,
  InferBlockProperties,
  InferCreateBlockInput,
  InferMergeBlockVersionInput,
  InferPartialBlockProperties,
  InferUpdateBlockInput,
} from './types';

const zodForBlockType: Record<BlockPropertyType, z.ZodType> = {
  string: z.string(),
  number: z.number(),
  boolean: z.boolean(),
  date: z.string(),
  richText: z.string(),
  image: z.string(),
  select: z.string(), // overridden below for select with options
  reference: z.string(),
};

export function buildPropertiesSchema<T extends Record<string, BlockProperty>>(
  properties: T,
  allOptional?: boolean,
): z.ZodType<InferBlockProperties<T>> {
  const shape: Record<string, z.ZodType> = {};
  let hasRequired = false;
  for (const [key, prop] of Object.entries(properties)) {
    let field: z.ZodType;

    if (prop.type === 'select') {
      const values = prop.options.map((o) => o.value);
      field = z.enum(values as [string, ...string[]]);
    } else {
      field = zodForBlockType[prop.type];
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

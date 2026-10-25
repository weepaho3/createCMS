import type { StandardSchemaV1 } from './standard-schema';
import type { AnyComponentDef, AnyEditorSchema, Field } from './types';

/**
 * The Standard JSON Schema converter a validator may expose next to
 * `validate` (https://standardschema.dev/json-schema). Implemented by Zod
 * 4.2+ and ArkType 2.1.28+; Valibot through `toStandardJsonSchema()` from
 * `@valibot/to-json-schema` with Valibot 1.5+.
 */
type JsonSchemaConverter = {
  readonly input: (options: {
    readonly target: string;
  }) => Record<string, unknown>;
};

export type JsonSchemaTarget = 'draft-2020-12' | 'draft-07';

export type ExportJsonSchemaOptions = { target?: JsonSchemaTarget };

type JsonSchema = Record<string, unknown>;

const LINK_SCHEMA: JsonSchema = {
  oneOf: [
    {
      type: 'object',
      required: ['kind', 'rootId', 'collection'],
      properties: {
        kind: { const: 'internal' },
        rootId: { type: 'string' },
        collection: { type: 'string' },
        fragment: { type: 'string' },
        query: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['kind', 'url'],
      properties: { kind: { const: 'external' }, url: { type: 'string' } },
    },
    {
      type: 'object',
      required: ['kind', 'email'],
      properties: { kind: { const: 'email' }, email: { type: 'string' } },
    },
    {
      type: 'object',
      required: ['kind', 'phone'],
      properties: { kind: { const: 'phone' }, phone: { type: 'string' } },
    },
  ],
};

/**
 * JSON Schema of every component's props: built-in field rules always; a
 * field's or component's Standard Schema validator is added with `allOf`
 * when it exposes the Standard JSON Schema converter, and skipped otherwise
 * (a converter that throws for the target is skipped too).
 */
export function exportJsonSchema(
  schema: AnyEditorSchema,
  options: ExportJsonSchemaOptions = {},
): JsonSchema {
  const target = options.target ?? 'draft-2020-12';
  const defs: Record<string, JsonSchema> = {
    root: componentSchema(schema.root, target),
  };
  for (const [type, def] of Object.entries(schema.components)) {
    defs[type] = componentSchema(def, target);
  }
  return {
    $schema:
      target === 'draft-07'
        ? 'http://json-schema.org/draft-07/schema#'
        : 'https://json-schema.org/draft/2020-12/schema',
    [target === 'draft-07' ? 'definitions' : '$defs']: defs,
  };
}

function componentSchema(def: AnyComponentDef, target: string): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [key, field] of Object.entries(def.fields)) {
    properties[key] = fieldSchema(field, target);
    if (field.required === true) required.push(key);
  }
  const base: JsonSchema = { type: 'object', properties };
  if (required.length > 0) base.required = required;
  if (def.label) base.title = def.label;
  return withValidator(base, def.validate, target);
}

function fieldSchema(field: Field, target: string): JsonSchema {
  let schema = plainSchema(field, target);
  if (field.label) schema.title = field.label;
  if (field.description) schema.description = field.description;
  if (field.responsive) {
    const entry = { ...schema };
    schema = {
      anyOf: [
        entry,
        {
          type: 'object',
          required: ['$r'],
          properties: {
            $r: {
              type: 'object',
              required: ['base'],
              properties: {
                base: entry,
                sm: entry,
                md: entry,
                lg: entry,
                xl: entry,
              },
            },
          },
        },
      ],
    };
  }
  if (field.localized) {
    const entry = { ...schema };
    schema = {
      anyOf: [
        entry,
        {
          type: 'object',
          required: ['$l'],
          properties: {
            $l: { type: 'object', additionalProperties: entry },
          },
        },
      ],
    };
  }
  const validator = field.type === 'custom' ? field.schema : undefined;
  return withValidator(
    withValidator(schema, validator, target),
    field.validate,
    target,
  );
}

function plainSchema(field: Field, target: string): JsonSchema {
  switch (field.type) {
    case 'richText':
      // Nodes nest arbitrarily; `validateRichText` checks the rest.
      return {
        type: 'object',
        required: ['type'],
        properties: {
          type: { const: 'doc' },
          content: {
            type: 'array',
            items: {
              type: 'object',
              required: ['type'],
              properties: { type: { type: 'string' } },
            },
          },
        },
      };
    case 'text':
    case 'textarea':
    case 'color': {
      const out: JsonSchema = { type: 'string' };
      if ('minLength' in field && field.minLength !== undefined) {
        out.minLength = field.minLength;
      }
      if ('maxLength' in field && field.maxLength !== undefined) {
        out.maxLength = field.maxLength;
      }
      if ('pattern' in field && field.pattern !== undefined) {
        out.pattern = field.pattern;
      }
      return out;
    }
    case 'date':
      return { type: 'string', format: 'date-time' };
    case 'number': {
      const out: JsonSchema = { type: 'number' };
      if (field.min !== undefined) out.minimum = field.min;
      if (field.max !== undefined) out.maximum = field.max;
      if (field.step !== undefined) out.multipleOf = field.step;
      return out;
    }
    case 'boolean':
      return { type: 'boolean' };
    case 'select': {
      const option = { enum: field.options.map((o) => o.value) };
      return field.multiple ? { type: 'array', items: option } : option;
    }
    case 'media': {
      const fraction = { type: 'number', minimum: 0, maximum: 1 };
      const point = {
        type: 'object',
        required: ['x', 'y'],
        properties: { x: fraction, y: fraction },
      };
      return {
        type: 'object',
        required: ['assetId'],
        properties: {
          assetId: { type: 'string' },
          alt: { type: 'string' },
          decorative: { type: 'boolean' },
          altSource: { enum: ['user', 'ai-suggested'] },
          caption: { type: 'string' },
          revisionId: { type: 'string' },
          crop: {
            type: 'object',
            required: ['x', 'y', 'width', 'height'],
            properties: {
              x: fraction,
              y: fraction,
              width: fraction,
              height: fraction,
            },
          },
          focal: point,
        },
        additionalProperties: false,
      };
    }
    case 'reference':
      return {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      };
    case 'link':
      return structuredClone(LINK_SCHEMA);
    case 'list': {
      const out: JsonSchema = {
        type: 'array',
        items: fieldSchema(field.of, target),
      };
      if (field.min !== undefined) out.minItems = field.min;
      if (field.max !== undefined) out.maxItems = field.max;
      return out;
    }
    case 'object': {
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, nested] of Object.entries(field.fields)) {
        properties[key] = fieldSchema(nested, target);
        if (nested.required === true) required.push(key);
      }
      return required.length > 0
        ? { type: 'object', properties, required }
        : { type: 'object', properties };
    }
    case 'custom':
      return {};
  }
}

function withValidator(
  schema: JsonSchema,
  validator: StandardSchemaV1 | undefined,
  target: string,
): JsonSchema {
  const converter = (
    validator?.['~standard'] as { jsonSchema?: JsonSchemaConverter } | undefined
  )?.jsonSchema;
  if (!converter) return schema;
  let extra: JsonSchema;
  try {
    extra = converter.input({ target });
  } catch {
    return schema;
  }
  const { $schema: _ignored, ...rest } = extra;
  return { allOf: [schema, rest] };
}

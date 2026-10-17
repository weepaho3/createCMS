import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { pages } from './fixtures';
import { exportJsonSchema } from './json-schema';
import { defineEditorSchema } from './types';

describe('exportJsonSchema', () => {
  it('describes every component with built-in rules', () => {
    const out = exportJsonSchema(pages) as {
      $schema: string;
      $defs: Record<
        string,
        { properties: Record<string, unknown>; required?: string[] }
      >;
    };
    expect(out.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(Object.keys(out.$defs)).toEqual([
      'root',
      ...Object.keys(pages.components),
    ]);
    expect(out.$defs.root?.required).toEqual(['title']);
    expect(out.$defs.heading?.properties.text).toEqual({
      type: 'string',
      minLength: 2,
      maxLength: 10,
      title: 'Text',
    });
    expect(out.$defs.image?.properties.url).toMatchObject({
      type: 'object',
      required: ['assetId'],
      additionalProperties: false,
      title: 'Image',
    });
    const url = out.$defs.image?.properties.url as
      | { properties: object }
      | undefined;
    expect(Object.keys(url?.properties ?? {})).toEqual([
      'assetId',
      'alt',
      'decorative',
      'altSource',
      'caption',
      'revisionId',
      'crop',
      'focal',
    ]);
    expect(out.$defs.card?.properties.flags).toEqual({
      type: 'array',
      items: { enum: ['new', 'hot'] },
      title: 'Flags',
    });
  });

  it('uses definitions for draft-07', () => {
    const out = exportJsonSchema(pages, { target: 'draft-07' });
    expect(out.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(out).toHaveProperty('definitions');
  });

  it('adds a zod validator through its Standard JSON Schema converter', () => {
    const schema = defineEditorSchema({
      root: { label: 'Root', fields: {} },
      components: {
        a: {
          label: 'A',
          fields: { email: { type: 'text', validate: z.email() } },
        },
      },
    });
    const out = exportJsonSchema(schema) as {
      $defs: { a: { properties: { email: { allOf?: unknown[] } } } };
    };
    const email = out.$defs.a.properties.email;
    expect(email.allOf).toHaveLength(2);
    expect(email.allOf?.[1]).toMatchObject({ type: 'string', format: 'email' });
  });

  it('skips a validator without the converter (valibot core)', () => {
    const schema = defineEditorSchema({
      root: { label: 'Root', fields: {} },
      components: {
        a: {
          label: 'A',
          fields: { code: { type: 'text', validate: v.string() } },
        },
      },
    });
    const out = exportJsonSchema(schema) as {
      $defs: { a: { properties: { code: unknown } } };
    };
    expect(out.$defs.a.properties.code).toEqual({ type: 'string' });
  });

  it('wraps responsive fields', () => {
    const schema = defineEditorSchema({
      root: { label: 'Root', fields: {} },
      components: {
        a: {
          label: 'A',
          fields: { gap: { type: 'number', responsive: true } },
        },
      },
    });
    const out = exportJsonSchema(schema) as {
      $defs: { a: { properties: { gap: { anyOf: unknown[] } } } };
    };
    expect(out.$defs.a.properties.gap.anyOf).toHaveLength(2);
  });
});

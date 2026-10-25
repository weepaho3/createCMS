import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { pages } from './fixtures';
import { defineComponent, defineEditorSchema } from './types';

const FUNCTION_KEYS = new Set([
  'render',
  'resolveData',
  'resolveFields',
  'hidden',
  'accept',
  'canPlace',
  'validate',
  'schema',
]);

/** Drops the keys a schema may hold functions or validator objects under. */
function dataOnly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dataOnly);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (FUNCTION_KEYS.has(key) && typeof item !== 'boolean') continue;
      out[key] = dataOnly(item);
    }
    return out;
  }
  return value;
}

describe('editor schema', () => {
  it('defineComponent and defineEditorSchema return their input', () => {
    const def = { label: 'A', fields: {} };
    expect(defineComponent(def)).toBe(def);
    expect(defineEditorSchema(pages)).toBe(pages);
  });

  it('is plain data apart from functions and validators', () => {
    const schema = defineEditorSchema({
      root: {
        label: 'Root',
        fields: { title: { type: 'text', hidden: (p) => p.mode === 'x' } },
        slots: { children: { accept: () => true } },
        render: () => null,
        resolveFields: () => ({}),
      },
      components: {
        a: {
          label: 'A',
          fields: { email: { type: 'text', validate: z.email() } },
        },
      },
      canPlace: () => true,
    });
    const data = dataOnly(schema);
    expect(structuredClone(data)).toEqual(data);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    expect(structuredClone(dataOnly(pages))).toEqual(dataOnly(pages));
  });
});

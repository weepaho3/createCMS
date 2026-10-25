import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { EditorDocument } from '../document';
import type { Field } from './types';

import { pages } from './fixtures';
import { defineEditorSchema } from './types';
import {
  isEmptyValue,
  missingRequired,
  validateDocument,
  validateField,
  validateNode,
} from './validation';

const codes = (field: Field, value: unknown) =>
  validateField(field, value).map((e) => e.code);

describe('isEmptyValue', () => {
  it.each<[Field, unknown, boolean]>([
    [{ type: 'text' }, undefined, true],
    [{ type: 'text' }, null, true],
    [{ type: 'text' }, '  ', true],
    [{ type: 'text' }, 'x', false],
    [{ type: 'number' }, 0, false],
    [{ type: 'boolean' }, false, false],
    [{ type: 'list', of: { type: 'text' } }, [], true],
    [{ type: 'select', options: [], multiple: true }, [], true],
    [{ type: 'media' }, { assetId: '' }, true],
    [{ type: 'media' }, { assetId: 'a1' }, false],
    [{ type: 'reference', collection: 'pages' }, { id: '' }, true],
    [{ type: 'reference', collection: 'pages' }, { id: 'r1' }, false],
    [{ type: 'link' }, { kind: 'external', url: '' }, true],
    [{ type: 'link' }, { kind: 'external', url: 'https://x.dev' }, false],
  ])('%j with %j → %s', (field, value, expected) => {
    expect(isEmptyValue(field, value)).toBe(expected);
  });
});

describe('validateField: rules per kind', () => {
  it('required', () => {
    expect(codes({ type: 'text', required: true }, undefined)).toEqual([
      'required',
    ]);
    expect(codes({ type: 'text', required: true }, ' ')).toEqual(['required']);
    expect(codes({ type: 'text' }, undefined)).toEqual([]);
  });

  it('text, textarea and richText lengths and pattern', () => {
    const field: Field = {
      type: 'text',
      minLength: 2,
      maxLength: 4,
      pattern: '^[a-z]+$',
    };
    expect(validateField(field, 'a')).toEqual([
      { code: 'minLength', path: [], params: { min: 2 } },
    ]);
    expect(codes(field, 'abcde')).toEqual(['maxLength']);
    expect(codes(field, 'AB')).toEqual(['pattern']);
    expect(codes({ type: 'textarea', maxLength: 1 }, 'ab')).toEqual([
      'maxLength',
    ]);
    expect(codes({ type: 'richText' }, 3)).toEqual(['type']);
  });

  it('number range and step', () => {
    const field: Field = { type: 'number', min: 1, max: 10, step: 2 };
    expect(codes(field, 0)).toEqual(['min', 'step']);
    expect(codes(field, 11)).toEqual(['max']);
    expect(codes(field, 3)).toEqual([]);
    expect(codes(field, 4)).toEqual(['step']);
    expect(codes({ type: 'number' }, Number.NaN)).toEqual(['type']);
  });

  it('boolean, date and color', () => {
    expect(codes({ type: 'boolean' }, 'yes')).toEqual(['type']);
    expect(codes({ type: 'date' }, '2026-10-17T10:00:00Z')).toEqual([]);
    expect(codes({ type: 'date' }, '2026-10-17')).toEqual(['format']);
    expect(codes({ type: 'color' }, '#fff')).toEqual([]);
    expect(codes({ type: 'color' }, 1)).toEqual(['type']);
  });

  it('select single and multiple', () => {
    const options = [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
    ];
    expect(codes({ type: 'select', options }, 'a')).toEqual([]);
    expect(codes({ type: 'select', options }, 'c')).toEqual(['option']);
    expect(
      validateField({ type: 'select', options, multiple: true }, ['a', 'c']),
    ).toEqual([{ code: 'option', path: [1] }]);
    expect(codes({ type: 'select', options, multiple: true }, 'a')).toEqual([
      'type',
    ]);
  });

  it('media and reference values are objects with an id', () => {
    expect(codes({ type: 'media' }, { assetId: 'a1' })).toEqual([]);
    expect(codes({ type: 'media' }, 'a1')).toEqual(['type']);
    expect(
      codes({ type: 'reference', collection: 'pages' }, { id: 'r1' }),
    ).toEqual([]);
    expect(codes({ type: 'reference', collection: 'pages' }, 'r1')).toEqual([
      'type',
    ]);
  });

  it('link kind, collection and target', () => {
    const field: Field = {
      type: 'link',
      allowedKinds: ['internal'],
      allowedCollections: ['pages'],
    };
    expect(codes(field, { kind: 'external', url: 'x' })).toEqual(['linkKind']);
    expect(
      codes(field, { kind: 'internal', rootId: 'r', collection: 'posts' }),
    ).toEqual(['linkCollection']);
    expect(
      codes(field, { kind: 'internal', rootId: ' ', collection: 'pages' }),
    ).toEqual(['linkTarget']);
    expect(codes(field, 'x')).toEqual(['type']);
  });

  it('list bounds and element paths', () => {
    const field: Field = {
      type: 'list',
      of: { type: 'text', minLength: 2 },
      min: 1,
      max: 2,
    };
    expect(codes(field, [])).toEqual(['minItems']);
    expect(validateField(field, ['ok', 'x', 'ok'])).toEqual([
      { code: 'maxItems', path: [], params: { max: 2 } },
      { code: 'minLength', path: [1], params: { min: 2 } },
    ]);
  });

  it('object fields and nested list paths', () => {
    const field: Field = {
      type: 'list',
      of: {
        type: 'object',
        fields: {
          label: { type: 'text', required: true },
          tags: { type: 'list', of: { type: 'number', max: 3 } },
        },
      },
    };
    expect(
      validateField(field, [{ label: 'a', tags: [1, 5] }, { tags: [] }]),
    ).toEqual([
      { code: 'max', path: [0, 'tags', 1], params: { max: 3 } },
      { code: 'required', path: [1, 'label'] },
    ]);
    expect(codes({ type: 'object', fields: {} }, [])).toEqual(['type']);
  });

  it('custom fields have no built-in rule', () => {
    expect(codes({ type: 'custom', kind: 'x' }, { any: 1 })).toEqual([]);
  });
});

describe('validateField: responsive and localized wrappers', () => {
  it('rejects $r on a field without responsive', () => {
    expect(codes({ type: 'number' }, { $r: { base: 1 } })).toEqual([
      'responsive',
    ]);
  });

  it('validates every breakpoint entry with its path', () => {
    expect(
      validateField(
        { type: 'number', max: 4, responsive: true },
        { $r: { base: 1, md: 9 } },
      ),
    ).toEqual([{ code: 'max', path: ['$r', 'md'], params: { max: 4 } }]);
  });

  it('rejects $l on a field without localized and validates entries', () => {
    expect(codes({ type: 'text' }, { $l: { de: 'x' } })).toEqual(['localized']);
    expect(
      validateField(
        { type: 'text', localized: true, maxLength: 1 },
        { $l: { de: 'x', en: 'yy' } },
      ),
    ).toEqual([{ code: 'maxLength', path: ['$l', 'en'], params: { max: 1 } }]);
  });

  it('keeps plain values valid on wrapper-capable fields', () => {
    expect(codes({ type: 'number', responsive: true }, 3)).toEqual([]);
  });
});

describe('validateNode', () => {
  const schema = defineEditorSchema({
    root: { label: 'Root', fields: {}, slots: { children: {} } },
    components: {
      hero: {
        label: 'Hero',
        fields: {
          variant: {
            type: 'select',
            options: [
              { label: 'Text', value: 'text' },
              { label: 'Image', value: 'image' },
            ],
          },
          image: {
            type: 'media',
            required: true,
            when: { field: 'variant', eq: 'image' },
          },
          note: { type: 'text', maxLength: 1, hidden: true },
        },
      },
    },
  });
  const hero = schema.components.hero;

  it('prefixes paths with the node id and field key', () => {
    expect(
      validateNode(
        { id: 'h1', type: 'hero', props: { variant: 'nope' } },
        hero,
      ),
    ).toEqual([{ code: 'option', path: ['h1', 'variant'], severity: 'error' }]);
  });

  it('skips hidden fields while editing', () => {
    expect(
      validateNode(
        { id: 'h1', type: 'hero', props: { variant: 'text', note: 'long' } },
        hero,
      ),
    ).toEqual([]);
  });

  it('checks required on hidden fields when publishing (configurable)', () => {
    const node = { id: 'h1', type: 'hero', props: { variant: 'text' } };
    expect(validateNode(node, hero, { phase: 'publish' })).toEqual([
      { code: 'required', path: ['h1', 'image'], severity: 'error' },
    ]);
    expect(
      validateNode(node, hero, {
        phase: 'publish',
        hiddenRequiredOnPublish: false,
      }),
    ).toEqual([]);
  });

  it('validates a field once its when condition holds', () => {
    expect(
      validateNode(
        { id: 'h1', type: 'hero', props: { variant: 'image' } },
        hero,
      ).map((i) => i.code),
    ).toEqual(['required']);
  });
});

describe('validateDocument', () => {
  const schema = defineEditorSchema({
    root: {
      label: 'Root',
      fields: { title: { type: 'text', required: true } },
      slots: { children: { allow: ['card'], min: 1, max: 2 } },
    },
    components: {
      card: {
        label: 'Card',
        fields: {
          email: { type: 'text', validate: z.email() },
          code: { type: 'text', validate: v.pipe(v.string(), v.length(3)) },
          slow: {
            type: 'text',
            validate: {
              '~standard': {
                version: 1,
                vendor: 'test',
                validate: async (value) =>
                  value === 'ok'
                    ? { value }
                    : { issues: [{ message: 'not ok', path: [{ key: 'x' }] }] },
              },
            },
          },
        },
        validate: z
          .object({ email: z.string().optional() })
          .refine((props) => props.email !== 'blocked@example.com', {
            message: 'blocked',
            path: ['email'],
          }),
      },
      note: { label: 'Note', fields: {} },
    },
  });

  const doc = (children: unknown[], props = { title: 'T' }): EditorDocument =>
    ({
      schemaVersion: 1,
      root: { id: 'root', type: 'root', props, slots: { children } },
    }) as EditorDocument;

  it('reports a valid document as clean', async () => {
    expect(
      await validateDocument(
        doc([{ id: 'c1', type: 'card', props: { slow: 'ok' } }]),
        schema,
      ),
    ).toEqual([]);
  });

  it('slot cardinality warns while editing and fails publishing', async () => {
    const empty = doc([]);
    expect(await validateDocument(empty, schema)).toEqual([
      {
        code: 'slotMin',
        path: ['root', '$slots', 'children'],
        params: { min: 1 },
        severity: 'warning',
      },
    ]);
    expect(
      (await validateDocument(empty, schema, { phase: 'publish' }))[0]
        ?.severity,
    ).toBe('error');
  });

  it('reports structure: placement, unknown type and slot, duplicate id', async () => {
    const issues = await validateDocument(
      doc([
        { id: 'n1', type: 'note', props: {} },
        { id: 'c1', type: 'card', props: {}, slots: { extra: [] } },
        { id: 'c1', type: 'card', props: {} },
        { id: 'x1', type: 'ghost', props: {} },
      ]),
      schema,
    );
    expect(issues.map((i) => [i.code, i.path.join('/')])).toEqual([
      ['slotMax', 'root/$slots/children'],
      ['placement', 'root/$slots/children/n1'],
      ['placement', 'root/$slots/children/x1'],
      ['unknownSlot', 'c1/$slots/extra'],
      ['duplicateId', 'c1'],
      ['unknownType', 'x1'],
    ]);
  });

  it('runs built-in rules on every node', async () => {
    const issues = await validateDocument(
      doc([{ id: 'c1', type: 'card', props: { slow: 'ok' } }], { title: '' }),
      schema,
    );
    expect(issues).toEqual([
      { code: 'required', path: ['root', 'title'], severity: 'error' },
    ]);
  });

  it('runs zod, valibot and async Standard Schema validators with mapped paths', async () => {
    const issues = await validateDocument(
      doc([
        {
          id: 'c1',
          type: 'card',
          props: { email: 'nope', code: 'ab', slow: 'bad' },
        },
      ]),
      schema,
    );
    expect(issues.map((i) => [i.code, i.path.join('/')])).toEqual([
      ['schema', 'c1/email'],
      ['schema', 'c1/code'],
      ['schema', 'c1/slow/x'],
    ]);
    expect(issues.every((i) => typeof i.params?.message === 'string')).toBe(
      true,
    );
  });

  it('runs the component validator on the whole props object', async () => {
    const issues = await validateDocument(
      doc([
        {
          id: 'c1',
          type: 'card',
          props: { email: 'blocked@example.com', slow: 'ok' },
        },
      ]),
      schema,
    );
    expect(issues).toEqual([
      {
        code: 'schema',
        path: ['c1', 'email'],
        params: { message: 'blocked' },
        severity: 'error',
      },
    ]);
  });
});

describe('missingRequired', () => {
  it('lists empty required fields of blocks and the root, label falls back to the key', () => {
    const schema = defineEditorSchema({
      root: {
        label: 'Root',
        fields: { title: { type: 'text', required: true } },
      },
      components: {
        image: {
          label: 'Image',
          fields: { url: { type: 'media', required: true, label: 'Image' } },
        },
      },
    });
    expect(
      missingRequired(schema, [
        { id: 'root', type: 'root', props: {} },
        { id: 'i1', type: 'image', props: { url: { assetId: '' } } },
        { id: 'i2', type: 'image', props: { url: { assetId: 'a' } } },
      ]),
    ).toEqual([
      { blockId: 'root', blockType: 'root', key: 'title', label: 'title' },
      { blockId: 'i1', blockType: 'image', key: 'url', label: 'Image' },
    ]);
  });

  it('accepts the shared fixture schema', () => {
    expect(
      missingRequired(pages, [{ id: 'r', type: 'root', props: {} }]),
    ).toEqual([
      { blockId: 'r', blockType: 'root', key: 'title', label: 'Title' },
    ]);
  });
});

describe('core validation stays text-free', () => {
  it('has no message literals in the validation module', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, 'validation.ts'), 'utf8');
    expect(source).not.toMatch(/message:\s*['"`]/);
  });
});

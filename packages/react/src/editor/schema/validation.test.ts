import type { BlockProperty } from '@createcms/schema';

import { describe, expect, it } from 'vitest';

import type { MissingRequiredNode } from './validation';

import { pages } from './fixtures';
import { isEmptyValue, missingRequired, validateField } from './validation';

const codes = (errors: { code: string }[]) => errors.map((e) => e.code);

describe('isEmptyValue', () => {
  const stringSpec = pages.blocks.heading.properties.text as BlockProperty;
  const listSpec = pages.blocks.cta.properties.tags as BlockProperty;
  const linkSpec = pages.blocks.cta.properties.link as BlockProperty;

  it('null/undefined → true', () => {
    expect(isEmptyValue(stringSpec, null)).toBe(true);
    expect(isEmptyValue(stringSpec, undefined)).toBe(true);
  });

  it('""/"   " → true', () => {
    expect(isEmptyValue(stringSpec, '')).toBe(true);
    expect(isEmptyValue(stringSpec, '   ')).toBe(true);
  });

  it('"x" → false', () => {
    expect(isEmptyValue(stringSpec, 'x')).toBe(false);
  });

  it('0/false → false', () => {
    expect(isEmptyValue(pages.blocks.heading.properties.level, 0)).toBe(false);
    expect(isEmptyValue(pages.blocks.cta.properties.enabled, false)).toBe(
      false,
    );
  });

  it('list [] → true, ["a"] → false', () => {
    expect(isEmptyValue(listSpec, [])).toBe(true);
    expect(isEmptyValue(listSpec, ['a'])).toBe(false);
  });

  it('link: undefined → true, blank target → true, real target → false, unknown kind → true', () => {
    expect(isEmptyValue(linkSpec, undefined)).toBe(true);
    expect(isEmptyValue(linkSpec, { kind: 'external', url: '  ' })).toBe(true);
    expect(
      isEmptyValue(linkSpec, {
        kind: 'internal',
        rootId: 'rot_1',
        collection: 'pages',
      }),
    ).toBe(false);
    expect(isEmptyValue(linkSpec, { kind: 'weird' })).toBe(true);
  });
});

describe('validateField: required gate', () => {
  const requiredStringWithMinLength: BlockProperty = {
    type: 'string',
    label: 'X',
    required: true,
    minLength: 5,
  };
  const optionalStringNoConstraints: BlockProperty = {
    type: 'string',
    label: 'X',
  };
  const requiredList: BlockProperty = {
    type: 'list',
    label: 'L',
    required: true,
    of: { type: 'string' },
  };

  it('required string "" and "   " → [{code: required}] only, no minLength', () => {
    expect(codes(validateField(requiredStringWithMinLength, ''))).toEqual([
      'required',
    ]);
    expect(codes(validateField(requiredStringWithMinLength, '   '))).toEqual([
      'required',
    ]);
  });

  it('optional string "" without constraints → []', () => {
    expect(validateField(optionalStringNoConstraints, '')).toEqual([]);
  });

  it('ad-hoc required list [] → [required]', () => {
    expect(codes(validateField(requiredList, []))).toEqual(['required']);
  });

  it('undefined/null on an optional field of every kind → []', () => {
    const optionalSpecsOfEveryKind: BlockProperty[] = [
      { type: 'string', label: 'S' },
      { type: 'richText', label: 'R' },
      { type: 'number', label: 'N' },
      { type: 'boolean', label: 'B' },
      { type: 'date', label: 'D' },
      { type: 'image', label: 'I' },
      { type: 'reference', label: 'Ref', collection: 'pages' },
      { type: 'select', label: 'Sel', options: [{ label: 'A', value: 'a' }] },
      { type: 'link', label: 'L' },
      { type: 'list', label: 'List', of: { type: 'string' } },
    ];
    for (const spec of optionalSpecsOfEveryKind) {
      expect(validateField(spec, undefined)).toEqual([]);
      expect(validateField(spec, null)).toEqual([]);
    }
  });

  it('undefined on a required field → [required]', () => {
    expect(
      codes(validateField(pages.root.properties.title, undefined)),
    ).toEqual(['required']);
  });
});

describe('validateField: string / richText', () => {
  const paragraphText = pages.blocks.paragraph.properties.text;

  it('"a" with minLength: 2 → minLength', () => {
    expect(
      codes(validateField({ type: 'string', label: 'X', minLength: 2 }, 'a')),
    ).toEqual(['minLength']);
  });

  it('11 chars with maxLength: 10 → maxLength', () => {
    expect(
      codes(
        validateField(
          { type: 'string', label: 'X', maxLength: 10 },
          '12345678901',
        ),
      ),
    ).toEqual(['maxLength']);
  });

  it('"lower" with pattern "^[A-Z]" → pattern', () => {
    expect(codes(validateField(paragraphText, 'lower'))).toEqual(['pattern']);
  });

  it('"Xlower" → []', () => {
    expect(validateField(paragraphText, 'Xlower')).toEqual([]);
  });

  it('pattern is unanchored: "abc" with pattern "b" → []', () => {
    expect(
      validateField({ type: 'string', label: 'X', pattern: 'b' }, 'abc'),
    ).toEqual([]);
  });

  it('a number value → type (and no length errors)', () => {
    expect(
      codes(validateField(pages.blocks.heading.properties.text, 123)),
    ).toEqual(['type']);
  });

  it('a present blank "  " on a NON-required field with minLength: 3 → [minLength]', () => {
    expect(
      codes(validateField({ type: 'string', label: 'X', minLength: 3 }, '  ')),
    ).toEqual(['minLength']);
  });
});

describe('validateField: number', () => {
  const plainNumber: BlockProperty = { type: 'number', label: 'N' };

  it('"3" → type', () => {
    expect(codes(validateField(plainNumber, '3'))).toEqual(['type']);
  });

  it('NaN → type', () => {
    expect(codes(validateField(plainNumber, Number.NaN))).toEqual(['type']);
  });

  it('0 with min: 1 → min', () => {
    expect(
      codes(validateField({ type: 'number', label: 'N', min: 1 }, 0)),
    ).toEqual(['min']);
  });

  it('7 with max: 6 → max', () => {
    expect(
      codes(validateField({ type: 'number', label: 'N', max: 6 }, 7)),
    ).toEqual(['max']);
  });

  it('3 → []', () => {
    expect(validateField(plainNumber, 3)).toEqual([]);
  });
});

describe('validateField: boolean', () => {
  const boolSpec: BlockProperty = { type: 'boolean', label: 'B' };

  it('"true" → type', () => {
    expect(codes(validateField(boolSpec, 'true'))).toEqual(['type']);
  });

  it('true → []', () => {
    expect(validateField(boolSpec, true)).toEqual([]);
  });
});

describe('validateField: date', () => {
  const dateSpec: BlockProperty = { type: 'date', label: 'D' };

  it('"2024-01-01T00:00:00Z" → []', () => {
    expect(validateField(dateSpec, '2024-01-01T00:00:00Z')).toEqual([]);
  });

  it('"2024-01-01T00:00Z" → []', () => {
    expect(validateField(dateSpec, '2024-01-01T00:00Z')).toEqual([]);
  });

  it('"2024-01-01" → format', () => {
    expect(codes(validateField(dateSpec, '2024-01-01'))).toEqual(['format']);
  });

  it('"2024-01-01T00:00:00+02:00" → format', () => {
    expect(codes(validateField(dateSpec, '2024-01-01T00:00:00+02:00'))).toEqual(
      ['format'],
    );
  });

  it('"2024-13-01T00:00:00Z" → format', () => {
    expect(codes(validateField(dateSpec, '2024-13-01T00:00:00Z'))).toEqual([
      'format',
    ]);
  });

  it('123 → type', () => {
    expect(codes(validateField(dateSpec, 123))).toEqual(['type']);
  });
});

describe('validateField: select', () => {
  const variant = pages.blocks.cta.properties.variant;

  it('"solid" → []', () => {
    expect(validateField(variant, 'solid')).toEqual([]);
  });

  it('"outline" → option', () => {
    expect(codes(validateField(variant, 'outline'))).toEqual(['option']);
  });

  it('1 → type', () => {
    expect(codes(validateField(variant, 1))).toEqual(['type']);
  });
});

describe('validateField: link', () => {
  const link = pages.blocks.cta.properties.link;
  const adHocOptionalLink: BlockProperty = { type: 'link', label: 'L' };

  it('{kind: external, url: /docs} → []', () => {
    expect(validateField(link, { kind: 'external', url: '/docs' })).toEqual([]);
  });

  it('{kind: email, email: a@b} → linkKind (not in allowedKinds)', () => {
    expect(codes(validateField(link, { kind: 'email', email: 'a@b' }))).toEqual(
      ['linkKind'],
    );
  });

  it('{kind: internal, rootId: rot_1, collection: posts} → linkCollection', () => {
    expect(
      codes(
        validateField(link, {
          kind: 'internal',
          rootId: 'rot_1',
          collection: 'posts',
        }),
      ),
    ).toEqual(['linkCollection']);
  });

  it('{kind: internal, rootId: "", collection: pages} → [required] only (required gate wins)', () => {
    expect(
      codes(
        validateField(link, {
          kind: 'internal',
          rootId: '',
          collection: 'pages',
        }),
      ),
    ).toEqual(['required']);
  });

  it('the same value on an ad-hoc NON-required link spec → linkTarget', () => {
    expect(
      codes(
        validateField(adHocOptionalLink, {
          kind: 'internal',
          rootId: '',
          collection: 'pages',
        }),
      ),
    ).toEqual(['linkTarget']);
  });

  it('{kind: weird} on the ad-hoc spec → linkKind', () => {
    expect(codes(validateField(adHocOptionalLink, { kind: 'weird' }))).toEqual([
      'linkKind',
    ]);
  });

  it('a link spec with value: "https://x" (string) → type', () => {
    expect(codes(validateField(adHocOptionalLink, 'https://x'))).toEqual([
      'type',
    ]);
  });

  it('a link spec without allowedKinds accepts all four kinds', () => {
    expect(
      validateField(adHocOptionalLink, { kind: 'phone', phone: '123' }),
    ).toEqual([]);
    expect(
      validateField(adHocOptionalLink, { kind: 'email', email: 'a@b' }),
    ).toEqual([]);
  });
});

describe('validateField: list', () => {
  const tags = pages.blocks.cta.properties.tags;
  const sizes = pages.blocks.cta.properties.sizes;

  it('[] → [minItems] (present, optional, below min, like the server)', () => {
    expect(codes(validateField(tags, []))).toEqual(['minItems']);
  });

  it('["a","b","c","d"] → maxItems', () => {
    expect(codes(validateField(tags, ['a', 'b', 'c', 'd']))).toEqual([
      'maxItems',
    ]);
  });

  it('["ok",""] → one minLength error with index: 1', () => {
    const errors = validateField(tags, ['ok', '']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'minLength', index: 1 });
  });

  it('"a" → type', () => {
    expect(codes(validateField(tags, 'a'))).toEqual(['type']);
  });

  it('cta.sizes ["s","x"] → option with index: 1', () => {
    const errors = validateField(sizes, ['s', 'x']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'option', index: 1 });
  });

  it('a list of numbers with element min → min with index', () => {
    const numberList: BlockProperty = {
      type: 'list',
      label: 'Numbers',
      of: { type: 'number', min: 5 },
    };
    const errors = validateField(numberList, [10, 1]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'min', index: 1 });
  });

  it('an ad-hoc required list [] → [required] only', () => {
    const requiredList: BlockProperty = {
      type: 'list',
      label: 'L',
      required: true,
      of: { type: 'string' },
    };
    expect(codes(validateField(requiredList, []))).toEqual(['required']);
  });
});

describe('missingRequired', () => {
  const filledNodes = (): MissingRequiredNode[] => [
    {
      id: 'root',
      type: 'root',
      properties: {
        title: 'Home',
        slugHint: 'home',
        publishedAt: '2024-01-01T00:00:00Z',
      },
    },
    {
      id: 'img',
      type: 'image',
      properties: { url: 'asset_1', alt: '' },
    },
    {
      id: 'head',
      type: 'heading',
      properties: { text: 'Hello', level: 2 },
    },
  ];

  it('all filled → []', () => {
    expect(missingRequired(pages, filledNodes())).toEqual([]);
  });

  it('blank root title → [{ blockId: root, blockType: root, key: title, label: Title }]', () => {
    const nodes = filledNodes();
    nodes[0] = {
      ...nodes[0]!,
      properties: { ...nodes[0]!.properties, title: '' },
    };
    expect(missingRequired(pages, nodes)).toEqual([
      { blockId: 'root', blockType: 'root', key: 'title', label: 'Title' },
    ]);
  });

  it('whitespace image url → flagged, optional empty heading text ignored', () => {
    const nodes: MissingRequiredNode[] = [
      { id: 'root', type: 'root', properties: { title: 'Home' } },
      { id: 'img', type: 'image', properties: { url: '   ', alt: '' } },
      { id: 'head', type: 'heading', properties: { text: '' } },
    ];
    const missing = missingRequired(pages, nodes);
    expect(missing).toEqual([
      { blockId: 'img', blockType: 'image', key: 'url', label: 'Image' },
    ]);
  });

  it('undefined root title → flagged', () => {
    const nodes: MissingRequiredNode[] = [
      { id: 'root', type: 'root', properties: {} },
    ];
    expect(missingRequired(pages, nodes)).toEqual([
      { blockId: 'root', blockType: 'root', key: 'title', label: 'Title' },
    ]);
  });

  it('required link pointing nowhere → flagged, real target → not flagged', () => {
    const withoutTarget: MissingRequiredNode[] = [
      {
        id: 'cta1',
        type: 'cta',
        properties: { link: { kind: 'external', url: '' } },
      },
    ];
    expect(missingRequired(pages, withoutTarget)).toEqual([
      { blockId: 'cta1', blockType: 'cta', key: 'link', label: 'Link' },
    ]);

    const withTarget: MissingRequiredNode[] = [
      {
        id: 'cta2',
        type: 'cta',
        properties: { link: { kind: 'external', url: '/x' } },
      },
    ];
    expect(missingRequired(pages, withTarget)).toEqual([]);
  });

  it('a cta with tags: [] → NOT flagged (tags is not required in the fixture)', () => {
    const nodes: MissingRequiredNode[] = [
      {
        id: 'cta1',
        type: 'cta',
        properties: { link: { kind: 'external', url: '/x' }, tags: [] },
      },
    ];
    expect(missingRequired(pages, nodes)).toEqual([]);
  });

  it('an ad-hoc schema with a required list flags an empty list', () => {
    const schema = {
      label: 'X',
      root: { properties: {} },
      blocks: {
        a: {
          label: 'A',
          properties: {
            items: {
              type: 'list' as const,
              label: 'Items',
              required: true,
              of: { type: 'string' as const },
            },
          },
        },
      },
    };
    const nodes: MissingRequiredNode[] = [
      { id: 'a1', type: 'a', properties: { items: [] } },
    ];
    expect(missingRequired(schema, nodes)).toEqual([
      { blockId: 'a1', blockType: 'a', key: 'items', label: 'Items' },
    ]);
  });

  it('unknown block type → nothing flagged', () => {
    const nodes: MissingRequiredNode[] = [
      { id: 'x1', type: 'unknown-type', properties: {} },
    ];
    expect(missingRequired(pages, nodes)).toEqual([]);
  });

  it('ordering = node order then definition order', () => {
    const nodes: MissingRequiredNode[] = [
      {
        id: 'cta1',
        type: 'cta',
        properties: {},
      },
      { id: 'root', type: 'root', properties: {} },
    ];
    const missing = missingRequired(pages, nodes);
    expect(missing.map((m) => `${m.blockId}:${m.key}`)).toEqual([
      'cta1:link',
      'root:title',
    ]);
  });
});

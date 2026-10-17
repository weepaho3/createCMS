import { describe, expect, it } from 'vitest';

import {
  componentOf,
  fieldsOf,
  groupFields,
  groupPaletteItems,
  paletteItems,
} from './fields';
import { pages } from './fixtures';
import { defineEditorSchema } from './types';

describe('componentOf / fieldsOf', () => {
  it('reads the root for the literal "root"', () => {
    expect(componentOf(pages, 'root')).toBe(pages.root);
    expect(Object.keys(fieldsOf(pages, 'root'))).toEqual([
      'title',
      'slugHint',
      'publishedAt',
    ]);
  });

  it('reads a component and yields {} for an unknown type', () => {
    expect(Object.keys(fieldsOf(pages, 'heading'))).toEqual(['text', 'level']);
    expect(fieldsOf(pages, 'ghost')).toEqual({});
    expect(componentOf(pages, 'ghost')).toBeUndefined();
  });

  it('resolves aliases', () => {
    const schema = defineEditorSchema({
      root: { label: 'Root', fields: {} },
      components: { title: { label: 'Title', fields: {} } },
      aliases: { headline: 'title' },
    });
    expect(componentOf(schema, 'headline')).toBe(schema.components.title);
  });
});

describe('groupFields', () => {
  it('named groups first in first-appearance order, ungrouped last', () => {
    const groups = groupFields(fieldsOf(pages, 'root'));
    expect(groups.map((g) => g.group)).toEqual(['Content', 'SEO', null]);
    expect(groups.map((g) => g.fields.map((f) => f.key))).toEqual([
      ['title'],
      ['slugHint'],
      ['publishedAt'],
    ]);
  });

  it('omits the null bucket when every field is grouped', () => {
    expect(
      groupFields({ a: { type: 'text', group: 'G' } }).map((g) => g.group),
    ).toEqual(['G']);
  });
});

describe('paletteItems / groupPaletteItems', () => {
  it('lists insertable components in definition order', () => {
    const items = paletteItems(pages);
    expect(items.map((item) => item.type)).not.toContain('hidden');
    expect(items[0]).toEqual({
      type: 'heading',
      label: 'Heading',
      category: 'Text',
      allowChildren: false,
    });
    expect(items.find((item) => item.type === 'image')).toEqual({
      type: 'image',
      label: 'Image',
      icon: 'image',
      allowChildren: false,
    });
    expect(items.find((item) => item.type === 'cta')?.previewImageUrl).toBe(
      '/previews/cta.png',
    );
    expect(items.find((item) => item.type === 'section')?.allowChildren).toBe(
      true,
    );
  });

  it('groups by category, uncategorised last', () => {
    const groups = groupPaletteItems(paletteItems(pages));
    expect(groups.map((g) => g.category)).toEqual(['Text', 'Marketing', null]);
    expect(groups[0]?.items.map((i) => i.type)).toEqual([
      'heading',
      'paragraph',
    ]);
  });
});

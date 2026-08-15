import { describe, expect, it } from 'vitest';

import {
  groupFields,
  groupPaletteItems,
  paletteItems,
  propertiesOf,
} from './fields';
import { pages } from './fixtures';

describe('propertiesOf', () => {
  it('propertiesOf(pages, "root") is pages.root.properties', () => {
    expect(propertiesOf(pages, 'root')).toBe(pages.root.properties);
  });

  it('propertiesOf(pages, "heading") is the heading properties', () => {
    expect(propertiesOf(pages, 'heading')).toBe(
      pages.blocks.heading.properties,
    );
  });

  it('an unknown type → {}', () => {
    expect(propertiesOf(pages, 'nope')).toEqual({});
  });
});

describe('groupFields', () => {
  it('root properties → groups [Content, SEO, null]', () => {
    const groups = groupFields(pages.root.properties);
    expect(groups.map((g) => g.group)).toEqual(['Content', 'SEO', null]);
    expect(groups.map((g) => g.fields.map((f) => f.key))).toEqual([
      ['title'],
      ['slugHint'],
      ['publishedAt'],
    ]);
  });

  it('cta properties → a single null group with all keys in definition order', () => {
    const groups = groupFields(pages.blocks.cta.properties);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.group).toBe(null);
    expect(groups[0]?.fields.map((f) => f.key)).toEqual([
      'variant',
      'enabled',
      'target',
      'link',
      'tags',
      'sizes',
    ]);
  });

  it('groupFields({}) → []', () => {
    expect(groupFields({})).toEqual([]);
  });

  it('mixed order (a:X, b:ungrouped, c:Y, d:X) → [X:[a,d], Y:[c], null:[b]]', () => {
    const groups = groupFields({
      a: { type: 'string', label: 'A', group: 'X' },
      b: { type: 'string', label: 'B' },
      c: { type: 'string', label: 'C', group: 'Y' },
      d: { type: 'string', label: 'D', group: 'X' },
    });
    expect(groups.map((g) => g.group)).toEqual(['X', 'Y', null]);
    expect(groups.map((g) => g.fields.map((f) => f.key))).toEqual([
      ['a', 'd'],
      ['c'],
      ['b'],
    ]);
  });
});

describe('paletteItems', () => {
  const items = paletteItems(pages);

  it('8 items in definition order', () => {
    expect(items.map((i) => i.type)).toEqual([
      'heading',
      'paragraph',
      'image',
      'cta',
      'section',
      'freeContainer',
      'sealed',
      'noChildrenFlag',
    ]);
  });

  it('paragraph carries description, allowChildren: false', () => {
    const paragraph = items.find((i) => i.type === 'paragraph');
    expect(paragraph?.description).toBe('A block of body text');
    expect(paragraph?.allowChildren).toBe(false);
  });

  it('cta carries previewImageUrl and group: "Marketing"', () => {
    const cta = items.find((i) => i.type === 'cta');
    expect(cta?.previewImageUrl).toBe('/previews/cta.png');
    expect(cta?.group).toBe('Marketing');
  });

  it('section allowChildren: true', () => {
    expect(items.find((i) => i.type === 'section')?.allowChildren).toBe(true);
  });

  it('noChildrenFlag allowChildren: false', () => {
    expect(items.find((i) => i.type === 'noChildrenFlag')?.allowChildren).toBe(
      false,
    );
  });
});

describe('groupPaletteItems', () => {
  it('groups [Text, Marketing, null] with the expected members', () => {
    const groups = groupPaletteItems(paletteItems(pages));
    expect(groups.map((g) => g.group)).toEqual(['Text', 'Marketing', null]);
    expect(groups.map((g) => g.items.map((i) => i.type))).toEqual([
      ['heading', 'paragraph'],
      ['cta'],
      ['image', 'section', 'freeContainer', 'sealed', 'noChildrenFlag'],
    ]);
  });
});

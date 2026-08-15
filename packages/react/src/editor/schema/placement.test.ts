import { describe, expect, it } from 'vitest';

import { pages } from './fixtures';
import { allowedChildTypes, canPlace, getPlacement } from './placement';

describe('getPlacement', () => {
  it('blockTypes is every block type, in definition order', () => {
    const index = getPlacement(pages);
    expect([...index.blockTypes]).toEqual([
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

  it('containers is every block with allowChildren: true', () => {
    const index = getPlacement(pages);
    expect([...index.containers].sort()).toEqual(
      ['section', 'freeContainer', 'sealed'].sort(),
    );
  });

  it('rules has an entry for section (only)', () => {
    const index = getPlacement(pages);
    expect(index.rules.get('section')).toEqual({
      mode: 'only',
      set: new Set(['heading', 'paragraph']),
    });
  });

  it('rules has an entry for root (except)', () => {
    const index = getPlacement(pages);
    expect(index.rules.get('root')).toEqual({
      mode: 'except',
      set: new Set(['heading']),
    });
  });

  it('rules has an entry for sealed (only, empty set)', () => {
    const index = getPlacement(pages);
    expect(index.rules.get('sealed')).toEqual({
      mode: 'only',
      set: new Set(),
    });
  });

  it('rules has an entry for noChildrenFlag (only)', () => {
    const index = getPlacement(pages);
    expect(index.rules.get('noChildrenFlag')).toEqual({
      mode: 'only',
      set: new Set(['heading']),
    });
  });

  it('rules has NO entry for freeContainer (accepts: "*" is open)', () => {
    const index = getPlacement(pages);
    expect(index.rules.has('freeContainer')).toBe(false);
  });
});

describe('canPlace', () => {
  const index = getPlacement(pages);

  it('root accepts paragraph', () => {
    expect(canPlace(index, 'paragraph', 'root')).toBe(true);
  });

  it('root rejects heading (root blacklist)', () => {
    expect(canPlace(index, 'heading', 'root')).toBe(false);
  });

  it('section accepts heading', () => {
    expect(canPlace(index, 'heading', 'section')).toBe(true);
  });

  it('section rejects image', () => {
    expect(canPlace(index, 'image', 'section')).toBe(false);
  });

  it('freeContainer accepts anything, incl. an unknown type', () => {
    expect(canPlace(index, 'ghost', 'freeContainer')).toBe(true);
  });

  it('sealed rejects everything', () => {
    expect(canPlace(index, 'heading', 'sealed')).toBe(false);
    expect(canPlace(index, 'paragraph', 'sealed')).toBe(false);
  });

  it('noChildrenFlag rejects heading although its rule lists it (container gate first)', () => {
    expect(canPlace(index, 'heading', 'noChildrenFlag')).toBe(false);
  });

  it('a leaf (heading) rejects paragraph', () => {
    expect(canPlace(index, 'paragraph', 'heading')).toBe(false);
  });

  it('an unknown parent "nope" rejects', () => {
    expect(canPlace(index, 'heading', 'nope')).toBe(false);
  });

  it('unknown child under a whitelist parent rejects', () => {
    expect(canPlace(index, 'ghost', 'section')).toBe(false);
  });
});

describe('allowedChildTypes', () => {
  const index = getPlacement(pages);

  it('root → all except heading, in definition order', () => {
    expect(allowedChildTypes(index, 'root')).toEqual([
      'paragraph',
      'image',
      'cta',
      'section',
      'freeContainer',
      'sealed',
      'noChildrenFlag',
    ]);
  });

  it('section → [heading, paragraph]', () => {
    expect(allowedChildTypes(index, 'section')).toEqual([
      'heading',
      'paragraph',
    ]);
  });

  it('sealed → []', () => {
    expect(allowedChildTypes(index, 'sealed')).toEqual([]);
  });

  it('heading → [] (not a container)', () => {
    expect(allowedChildTypes(index, 'heading')).toEqual([]);
  });

  it('freeContainer → all eight types', () => {
    expect(allowedChildTypes(index, 'freeContainer')).toEqual([
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
});

describe('edge cases with ad-hoc schemas', () => {
  it('structure undefined → every container open', () => {
    const index = getPlacement({
      label: 'X',
      root: { properties: {} },
      blocks: { a: { label: 'A', allowChildren: true, properties: {} } },
    });
    expect(canPlace(index, 'a', 'a')).toBe(true);
    expect(canPlace(index, 'a', 'root')).toBe(true);
  });

  it('blocks undefined: root is open, any other parent is closed', () => {
    const index = getPlacement({
      label: 'X',
      root: { properties: {} },
    });
    expect(canPlace(index, 'x', 'root')).toBe(true);
    expect(canPlace(index, 'x', 'a')).toBe(false);
    expect(allowedChildTypes(index, 'root')).toEqual([]);
  });

  it('{ accepts: "*", excludes: [] } → open', () => {
    const index = getPlacement({
      label: 'X',
      root: { properties: {} },
      blocks: { a: { label: 'A', allowChildren: true, properties: {} } },
      structure: { a: { accepts: '*', excludes: [] } },
    });
    expect(index.rules.has('a')).toBe(false);
    expect(canPlace(index, 'anything', 'a')).toBe(true);
  });

  it('{ excludes: ["a"] } (no accepts) → except', () => {
    const index = getPlacement({
      label: 'X',
      root: { properties: {} },
      blocks: { a: { label: 'A', allowChildren: true, properties: {} } },
      structure: { a: { excludes: ['a'] } },
    });
    expect(index.rules.get('a')).toEqual({
      mode: 'except',
      set: new Set(['a']),
    });
  });

  it('a whitelist naming a type absent from blocks: allowedChildTypes omits it, canPlace still allows it', () => {
    const index = getPlacement({
      label: 'X',
      root: { properties: {} },
      blocks: { a: { label: 'A', allowChildren: true, properties: {} } },
      structure: { a: { accepts: ['ghost'] } },
    });
    expect(allowedChildTypes(index, 'a')).toEqual([]);
    expect(canPlace(index, 'ghost', 'a')).toBe(true);
  });
});

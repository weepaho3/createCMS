import { describe, expect, it } from 'vitest';

import { pages } from './fixtures';
import { allowedChildTypes, canPlace, getPlacement } from './placement';
import { defineEditorSchema } from './types';

describe('getPlacement', () => {
  it('blockTypes is every component type, in definition order', () => {
    const index = getPlacement(pages);
    expect([...index.blockTypes]).toEqual([
      'heading',
      'paragraph',
      'image',
      'cta',
      'card',
      'section',
      'freeContainer',
      'sealed',
      'noSlot',
      'hidden',
    ]);
  });

  it('containers are the root and every component with a children slot', () => {
    const index = getPlacement(pages);
    expect([...index.containers].sort()).toEqual(
      ['root', 'section', 'freeContainer', 'sealed'].sort(),
    );
  });

  it('allow becomes an only rule, disallow an except rule', () => {
    const index = getPlacement(pages);
    expect(index.rules.get('section')).toEqual({
      mode: 'only',
      set: new Set(['heading', 'paragraph']),
    });
    expect(index.rules.get('root')).toEqual({
      mode: 'except',
      set: new Set(['heading']),
    });
    expect(index.rules.get('sealed')).toEqual({ mode: 'only', set: new Set() });
  });

  it('an open slot has no rule', () => {
    expect(getPlacement(pages).rules.has('freeContainer')).toBe(false);
  });

  it('allow wins over disallow', () => {
    const index = getPlacement(
      defineEditorSchema({
        root: {
          label: 'Root',
          fields: {},
          slots: { children: { allow: ['a'], disallow: ['a'] } },
        },
        components: { a: { label: 'A', fields: {} } },
      }),
    );
    expect(canPlace(index, 'a', 'root')).toBe(true);
  });
});

describe('canPlace', () => {
  const index = getPlacement(pages);

  it('root accepts paragraph and rejects heading', () => {
    expect(canPlace(index, 'paragraph', 'root')).toBe(true);
    expect(canPlace(index, 'heading', 'root')).toBe(false);
  });

  it('section accepts heading and rejects image', () => {
    expect(canPlace(index, 'heading', 'section')).toBe(true);
    expect(canPlace(index, 'image', 'section')).toBe(false);
  });

  it('an open slot accepts anything, incl. an unknown type', () => {
    expect(canPlace(index, 'ghost', 'freeContainer')).toBe(true);
  });

  it('an empty allow list rejects everything', () => {
    expect(canPlace(index, 'heading', 'sealed')).toBe(false);
  });

  it('a component without a children slot rejects', () => {
    expect(canPlace(index, 'heading', 'noSlot')).toBe(false);
    expect(canPlace(index, 'paragraph', 'heading')).toBe(false);
  });

  it('an unknown parent rejects', () => {
    expect(canPlace(index, 'heading', 'nope')).toBe(false);
  });

  it('a root without a children slot holds nothing', () => {
    const closed = getPlacement(
      defineEditorSchema({
        root: { label: 'Root', fields: {} },
        components: { a: { label: 'A', fields: {} } },
      }),
    );
    expect(canPlace(closed, 'a', 'root')).toBe(false);
  });

  it('the global canPlace runs after the slot rule with the slot name', () => {
    const calls: string[] = [];
    const schema = defineEditorSchema({
      root: { label: 'Root', fields: {}, slots: { children: {} } },
      components: {
        a: { label: 'A', fields: {} },
        b: { label: 'B', fields: {} },
      },
      canPlace(child, parent, slot) {
        calls.push(`${child}>${parent}.${slot}`);
        return child !== 'b';
      },
    });
    const global = getPlacement(schema);
    expect(canPlace(global, 'a', 'root')).toBe(true);
    expect(canPlace(global, 'b', 'root')).toBe(false);
    expect(calls).toEqual(['a>root.children', 'b>root.children']);
  });
});

describe('allowedChildTypes', () => {
  const index = getPlacement(pages);

  it('root → every type but heading, in definition order', () => {
    expect(allowedChildTypes(index, 'root')).toEqual([
      'paragraph',
      'image',
      'cta',
      'card',
      'section',
      'freeContainer',
      'sealed',
      'noSlot',
      'hidden',
    ]);
  });

  it('section → its allow list, in definition order', () => {
    expect(allowedChildTypes(index, 'section')).toEqual([
      'heading',
      'paragraph',
    ]);
  });

  it('a leaf → []', () => {
    expect(allowedChildTypes(index, 'heading')).toEqual([]);
  });
});

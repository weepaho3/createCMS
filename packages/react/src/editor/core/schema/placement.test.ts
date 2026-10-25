import { describe, expect, it } from 'vitest';

import type { PlacementNode } from './placement';

import { pages } from './fixtures';
import { allowedChildTypes, canPlaceIn, slotsOf } from './placement';
import { defineEditorSchema } from './types';

/** A one-node table: a parent of `type` with id `p` and the given slots. */
function parentOf(
  type: string,
  slots: Record<string, string[]> = {},
): Record<string, PlacementNode> {
  return { p: { type, parent: null, slots } };
}

const IN = { id: 'p', slot: 'children' };

describe('slotsOf', () => {
  it('returns the declared slots, root included', () => {
    expect(Object.keys(slotsOf(pages, 'root'))).toEqual(['children']);
    expect(slotsOf(pages, 'heading')).toEqual({});
    expect(slotsOf(pages, 'nope')).toEqual({});
  });
});

describe('canPlaceIn', () => {
  const place = (child: string, parentType: string) =>
    canPlaceIn(pages, parentOf(parentType), child, IN).ok;

  it('root accepts paragraph and rejects heading', () => {
    expect(place('paragraph', 'root')).toBe(true);
    expect(canPlaceIn(pages, parentOf('root'), 'heading', IN)).toEqual({
      ok: false,
      code: 'not-allowed',
    });
  });

  it('section accepts heading and rejects image', () => {
    expect(place('heading', 'section')).toBe(true);
    expect(place('image', 'section')).toBe(false);
  });

  it('an open slot accepts anything, incl. an unknown type', () => {
    expect(place('ghost', 'freeContainer')).toBe(true);
  });

  it('an empty allow list rejects everything', () => {
    expect(place('heading', 'sealed')).toBe(false);
  });

  it('a slot the parent type does not declare is unknown-slot', () => {
    expect(canPlaceIn(pages, parentOf('noSlot'), 'heading', IN)).toEqual({
      ok: false,
      code: 'unknown-slot',
    });
    expect(
      canPlaceIn(pages, parentOf('section'), 'heading', {
        id: 'p',
        slot: 'aside',
      }),
    ).toEqual({ ok: false, code: 'unknown-slot' });
  });

  it('an unknown parent id is unknown-slot', () => {
    expect(
      canPlaceIn(pages, {}, 'heading', { id: 'ghost', slot: 'children' }),
    ).toEqual({ ok: false, code: 'unknown-slot' });
  });

  it('allow wins over disallow', () => {
    const schema = defineEditorSchema({
      root: {
        label: 'Root',
        fields: {},
        slots: { children: { allow: ['a'], disallow: ['a'] } },
      },
      components: { a: { label: 'A', fields: {} } },
    });
    expect(canPlaceIn(schema, parentOf('root'), 'a', IN).ok).toBe(true);
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
    expect(canPlaceIn(schema, parentOf('root'), 'a', IN).ok).toBe(true);
    expect(canPlaceIn(schema, parentOf('root'), 'b', IN).ok).toBe(false);
    expect(calls).toEqual(['a>root.children', 'b>root.children']);
  });

  describe('named slots', () => {
    const schema = defineEditorSchema({
      root: { label: 'Root', fields: {}, slots: { children: {} } },
      components: {
        columns: {
          label: 'Columns',
          fields: {},
          slots: {
            left: { allow: ['text'] },
            right: { max: 1 },
          },
        },
        text: { label: 'Text', fields: {} },
        image: { label: 'Image', fields: {} },
      },
    });
    const nodes: Record<string, PlacementNode> = {
      r: { type: 'root', parent: null, slots: { children: ['cols'] } },
      cols: {
        type: 'columns',
        parent: { id: 'r', slot: 'children' },
        slots: { left: ['t'], right: ['i'] },
      },
      t: { type: 'text', parent: { id: 'cols', slot: 'left' }, slots: {} },
      i: { type: 'image', parent: { id: 'cols', slot: 'right' }, slots: {} },
    };
    const left = { id: 'cols', slot: 'left' };
    const right = { id: 'cols', slot: 'right' };

    it('applies each slot its own rules', () => {
      expect(canPlaceIn(schema, nodes, 'text', left).ok).toBe(true);
      expect(canPlaceIn(schema, nodes, 'image', left)).toEqual({
        ok: false,
        code: 'not-allowed',
      });
    });

    it('a slot at max is slot-full', () => {
      expect(canPlaceIn(schema, nodes, 'text', right)).toEqual({
        ok: false,
        code: 'slot-full',
      });
    });

    it('a node moved within a full slot does not count twice', () => {
      expect(
        canPlaceIn(schema, nodes, 'image', right, { movingId: 'i' }).ok,
      ).toBe(true);
    });

    it('a move into the own subtree is self-nesting', () => {
      expect(
        canPlaceIn(schema, nodes, 'columns', left, { movingId: 'cols' }),
      ).toEqual({ ok: false, code: 'self-nesting' });
    });

    it('allowedChildTypes is per slot and empty for a full slot', () => {
      expect(allowedChildTypes(schema, nodes, left)).toEqual(['text']);
      expect(allowedChildTypes(schema, nodes, right)).toEqual([]);
      expect(
        allowedChildTypes(schema, nodes, right, { movingId: 'i' }),
      ).toEqual(['columns', 'text', 'image']);
    });
  });
});

describe('allowedChildTypes', () => {
  it('root: every type but heading, in definition order', () => {
    expect(allowedChildTypes(pages, parentOf('root'), IN)).toEqual([
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

  it('section: its allow list, in definition order', () => {
    expect(allowedChildTypes(pages, parentOf('section'), IN)).toEqual([
      'heading',
      'paragraph',
    ]);
  });

  it('a leaf: []', () => {
    expect(allowedChildTypes(pages, parentOf('heading'), IN)).toEqual([]);
  });
});

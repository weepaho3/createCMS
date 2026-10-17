import {
  fromCollection,
  fromEditor,
  toEditor,
} from '@createcms/react/editor/cms';
import { canPlace, getPlacement } from '@createcms/react/editor/core';
import { describe, expect, it } from 'vitest';

import { emails } from './email-schema';
import { EMAIL_TREE } from './email-tree';
import { pages } from './pages-schema';
import { PAGES_TREE } from './pages-tree';

describe('demo collections through the createcms adapter', () => {
  it.each([
    ['pages', pages],
    ['emails', emails],
  ] as const)('fromCollection maps every %s block', (_name, def) => {
    const schema = fromCollection(def);
    expect(Object.keys(schema.components)).toEqual(
      Object.keys(def.blocks ?? {}),
    );
    expect(schema.root.slots).toHaveProperty('children');
  });

  it('keeps the pages placement rules', () => {
    const index = getPlacement(fromCollection(pages));
    for (const [type, block] of Object.entries(pages.blocks ?? {})) {
      expect(index.containers.has(type)).toBe(block.allowChildren === true);
    }
    expect(canPlace(index, 'hero', 'root')).toBe(true);
  });

  it.each([
    ['pages', PAGES_TREE, pages],
    ['emails', EMAIL_TREE, emails],
  ] as const)('round-trips the %s demo tree', (_name, tree, def) => {
    expect(fromEditor(toEditor(tree, def), def)).toEqual(tree);
  });
});

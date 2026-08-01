import { describe, expect, it } from 'vitest';

import type { ReconstructedBlock } from '../../blocks/reconstruct-snapshot';
import type { AnnotatedBlockTreeNode, BlockChange } from '../types';

import { ROOT_SLUG_PROP } from '../../blocks/reconstruct-snapshot';
import { buildAnnotatedTree } from '../annotated-tree';

// ============================================================================
// Fixtures
// ============================================================================

function block(
  blockId: string,
  overrides: Partial<ReconstructedBlock> = {},
): ReconstructedBlock {
  return {
    blockId,
    blockVersionId: `bv_${blockId}`,
    type: 'text',
    properties: {},
    children: [],
    deleted: false,
    ...overrides,
  };
}

function toMap(
  ...blocks: ReconstructedBlock[]
): Map<string, ReconstructedBlock> {
  return new Map(blocks.map((b) => [b.blockId, b]));
}

/** A flat-list `deleted` entry whose `baseVersion` is the given base block. */
function deletion(base: ReconstructedBlock): BlockChange {
  return {
    blockId: base.blockId,
    changeTypes: ['deleted'],
    sourceVersion: null,
    targetVersion: null,
    baseVersion: base,
  };
}

function childIds(node: AnnotatedBlockTreeNode): string[] {
  return node.children.map((child) => child.blockId);
}

function collectIds(
  node: AnnotatedBlockTreeNode,
  out: string[] = [],
): string[] {
  out.push(node.blockId);
  for (const child of node.children) collectIds(child, out);
  return out;
}

// ============================================================================
// Tests
// ============================================================================

describe('buildAnnotatedTree', () => {
  it('re-inserts a middle deletion between its surviving base siblings', () => {
    const baseB = block('B', { properties: { text: 'middle' } });
    const tree = buildAnnotatedTree({
      sourceBlocks: toMap(
        block('root', { type: 'pages', children: ['A', 'C'] }),
        block('A'),
        block('B', { deleted: true }),
        block('C'),
      ),
      baseBlocks: toMap(
        block('root', { type: 'pages', children: ['A', 'B', 'C'] }),
        block('A'),
        baseB,
        block('C'),
      ),
      changes: [deletion(baseB)],
      rootId: 'root',
    });

    expect(childIds(tree!)).toEqual(['A', 'B', 'C']);
    const ghost = tree!.children[1];
    expect(ghost.diff?.changeTypes).toEqual(['deleted']);
  });

  it('re-inserts a head deletion before the surviving siblings', () => {
    const baseA = block('A');
    const tree = buildAnnotatedTree({
      sourceBlocks: toMap(
        block('root', { type: 'pages', children: ['B'] }),
        block('A', { deleted: true }),
        block('B'),
      ),
      baseBlocks: toMap(
        block('root', { type: 'pages', children: ['A', 'B'] }),
        baseA,
        block('B'),
      ),
      changes: [deletion(baseA)],
      rootId: 'root',
    });

    expect(childIds(tree!)).toEqual(['A', 'B']);
    expect(tree!.children[0].diff?.changeTypes).toEqual(['deleted']);
  });

  it('keeps base relative order for consecutive deletions (change order irrelevant)', () => {
    const baseB = block('B');
    const baseC = block('C');
    const tree = buildAnnotatedTree({
      sourceBlocks: toMap(
        block('root', { type: 'pages', children: ['A', 'D'] }),
        block('A'),
        block('B', { deleted: true }),
        block('C', { deleted: true }),
        block('D'),
      ),
      baseBlocks: toMap(
        block('root', { type: 'pages', children: ['A', 'B', 'C', 'D'] }),
        block('A'),
        baseB,
        baseC,
        block('D'),
      ),
      // Reversed on purpose: placement must follow base order, not list order.
      changes: [deletion(baseC), deletion(baseB)],
      rootId: 'root',
    });

    expect(childIds(tree!)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('nests a deleted subtree: child ghost inside the parent ghost', () => {
    const baseP = block('P', {
      type: 'section',
      properties: { title: 'gone' },
      children: ['C'],
    });
    const baseC = block('C');
    const tree = buildAnnotatedTree({
      sourceBlocks: toMap(
        block('root', { type: 'pages', children: [] }),
        block('P', { deleted: true }),
        block('C', { deleted: true }),
      ),
      baseBlocks: toMap(
        block('root', { type: 'pages', children: ['P'] }),
        baseP,
        baseC,
      ),
      // Child listed before parent: nesting must not depend on list order.
      changes: [deletion(baseC), deletion(baseP)],
      rootId: 'root',
    });

    expect(childIds(tree!)).toEqual(['P']);
    const ghostP = tree!.children[0];
    expect(ghostP.type).toBe('section');
    expect(ghostP.properties).toEqual({ title: 'gone' });
    expect(ghostP.diff?.changeTypes).toEqual(['deleted']);
    expect(childIds(ghostP)).toEqual(['C']);
    expect(ghostP.children[0].diff?.changeTypes).toEqual(['deleted']);
  });

  it('does not ghost a base child that was reparented away', () => {
    const baseC = block('C');
    const tree = buildAnnotatedTree({
      sourceBlocks: toMap(
        block('root', { type: 'pages', children: ['A'] }),
        block('A', { children: ['B'] }),
        block('B'),
        block('C', { deleted: true }),
      ),
      baseBlocks: toMap(
        block('root', { type: 'pages', children: ['A', 'B', 'C'] }),
        block('A'),
        block('B'),
        baseC,
      ),
      changes: [
        deletion(baseC),
        {
          blockId: 'B',
          changeTypes: ['moved'],
          moved: {
            kind: 'reparented',
            fromParentId: 'root',
            fromIndex: 1,
            toParentId: 'A',
            toIndex: 0,
          },
          sourceVersion: block('B'),
          targetVersion: block('B'),
          baseVersion: block('B'),
        },
      ],
      rootId: 'root',
    });

    // B lives under A only — no ghost of it under root, no duplicate node.
    expect(childIds(tree!)).toEqual(['A', 'C']);
    expect(childIds(tree!.children[0])).toEqual(['B']);
    expect(collectIds(tree!).filter((id) => id === 'B')).toHaveLength(1);
    expect(tree!.children[0].children[0].diff?.moved?.kind).toBe('reparented');
  });

  it('annotates changed nodes and omits diff on unchanged ones', () => {
    const tree = buildAnnotatedTree({
      sourceBlocks: toMap(
        block('root', { type: 'pages', children: ['A', 'B'] }),
        block('A', { properties: { text: 'new' } }),
        block('B'),
      ),
      baseBlocks: toMap(
        block('root', { type: 'pages', children: ['B'] }),
        block('B'),
      ),
      changes: [
        {
          blockId: 'A',
          changeTypes: ['added'],
          sourceVersion: block('A'),
          targetVersion: null,
          baseVersion: null,
        },
        {
          blockId: 'root',
          changeTypes: ['modified'],
          propertyChanges: [
            { path: ['title'], kind: 'changed', from: 'Old', to: 'New' },
          ],
          slugChange: { from: 'old-slug', to: 'new-slug' },
          sourceVersion: block('root'),
          targetVersion: block('root'),
          baseVersion: block('root'),
        },
      ],
      rootId: 'root',
    });

    const [a, b] = tree!.children;
    expect(a.diff?.changeTypes).toEqual(['added']);
    // The annotation carries ONLY render-facing fields — never the versions.
    expect(Object.keys(a.diff!)).toEqual(['changeTypes']);
    expect(b.diff).toBeUndefined();
    expect(tree!.diff?.propertyChanges).toEqual([
      { path: ['title'], kind: 'changed', from: 'Old', to: 'New' },
    ]);
    expect(tree!.diff?.slugChange).toEqual({
      from: 'old-slug',
      to: 'new-slug',
    });
    expect(tree!.diff).not.toHaveProperty('sourceVersion');
    expect(tree!.diff).not.toHaveProperty('baseVersion');
  });

  it('translates the root to type "root" and strips the reserved slug key', () => {
    const tree = buildAnnotatedTree({
      sourceBlocks: toMap(
        block('root', {
          type: 'pages',
          properties: { [ROOT_SLUG_PROP]: 'about', title: 'About' },
        }),
      ),
      baseBlocks: toMap(block('root', { type: 'pages' })),
      changes: [],
      rootId: 'root',
    });

    expect(tree!.type).toBe('root');
    expect(tree!.properties).toEqual({ title: 'About' });
    expect(ROOT_SLUG_PROP in tree!.properties).toBe(false);
  });

  it('gives ghosts their BASE properties, not the tombstone ones', () => {
    const baseA = block('A', {
      type: 'headline',
      properties: { text: 'the last words' },
    });
    const tree = buildAnnotatedTree({
      sourceBlocks: toMap(
        block('root', { type: 'pages', children: [] }),
        block('A', { deleted: true, properties: {} }),
      ),
      baseBlocks: toMap(
        block('root', { type: 'pages', children: ['A'] }),
        baseA,
      ),
      changes: [deletion(baseA)],
      rootId: 'root',
    });

    const ghost = tree!.children[0];
    expect(ghost.type).toBe('headline');
    expect(ghost.properties).toEqual({ text: 'the last words' });
    expect(ghost.diff?.changeTypes).toEqual(['deleted']);
    expect(ghost.children).toEqual([]);
  });

  it('returns null when the root is deleted in source', () => {
    const baseRoot = block('root', { type: 'pages', children: [] });
    expect(
      buildAnnotatedTree({
        sourceBlocks: toMap(block('root', { type: 'pages', deleted: true })),
        baseBlocks: toMap(baseRoot),
        changes: [deletion(baseRoot)],
        rootId: 'root',
      }),
    ).toBeNull();
    expect(
      buildAnnotatedTree({
        sourceBlocks: new Map(),
        baseBlocks: toMap(baseRoot),
        changes: [],
        rootId: 'root',
      }),
    ).toBeNull();
  });

  it('places a doubly-referenced deleted block exactly once (corrupted base)', () => {
    const baseX = block('X');
    const baseY = block('Y');
    const tree = buildAnnotatedTree({
      sourceBlocks: toMap(
        block('root', { type: 'pages', children: ['A', 'B'] }),
        block('A'),
        block('B'),
        block('X', { deleted: true }),
        block('Y', { deleted: true }),
      ),
      baseBlocks: toMap(
        block('root', { type: 'pages', children: ['A', 'B'] }),
        block('A', { children: ['X'] }),
        // Corrupted: B also claims X, and legitimately owns Y.
        block('B', { children: ['X', 'Y'] }),
        baseX,
        baseY,
      ),
      changes: [deletion(baseX), deletion(baseY)],
      rootId: 'root',
    });

    // First parent wins (matching classify's buildParentIndex): the X ghost
    // lands under A only, and B still receives its own ghost.
    expect(collectIds(tree!).filter((id) => id === 'X')).toHaveLength(1);
    expect(childIds(tree!.children[0])).toEqual(['X']);
    expect(childIds(tree!.children[1])).toEqual(['Y']);
  });

  it('skips (does not throw on) a deleted block with no reachable base parent', () => {
    const orphan = block('X', { properties: { text: 'orphan' } });
    const tree = buildAnnotatedTree({
      sourceBlocks: toMap(
        block('root', { type: 'pages', children: ['A'] }),
        block('A'),
      ),
      // X is referenced by nobody alive in base — no position to re-insert at.
      baseBlocks: toMap(
        block('root', { type: 'pages', children: ['A'] }),
        block('A'),
        orphan,
      ),
      changes: [deletion(orphan)],
      rootId: 'root',
    });

    expect(collectIds(tree!)).toEqual(['root', 'A']);
  });
});

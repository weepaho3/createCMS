import { describe, expect, it } from 'vitest';

import type { ReconstructedBlock } from '../../blocks/reconstruct-snapshot';
import type { DiffPropertySpec } from '../classify';
import type { BlockChange } from '../types';

import { ROOT_SLUG_PROP } from '../../blocks/reconstruct-snapshot';
import { classifyChanges } from '../classify';

// ============================================================================
// Fixtures
// ============================================================================

const ROOT_ID = 'root';

const BLOCK_DEFS: Record<
  string,
  { properties?: Record<string, DiffPropertySpec> }
> = {
  text: {
    properties: {
      title: { type: 'string' },
      body: { type: 'richText' },
    },
  },
  gallery: {
    properties: {
      captions: { type: 'list', of: { type: 'richText' } },
    },
  },
  hero: { properties: {} },
};

const ROOT_PROPERTIES: Record<string, DiffPropertySpec> = {
  title: { type: 'string' },
  intro: { type: 'richText' },
};

function block(
  blockId: string,
  opts: Partial<Omit<ReconstructedBlock, 'blockId'>> = {},
): ReconstructedBlock {
  return {
    blockId,
    blockVersionId: opts.blockVersionId ?? `${blockId}-v1`,
    type: opts.type ?? 'text',
    properties: opts.properties ?? {},
    children: opts.children ?? [],
    deleted: opts.deleted ?? false,
  };
}

function snapshot(
  ...blocks: ReconstructedBlock[]
): Map<string, ReconstructedBlock> {
  return new Map(blocks.map((entry) => [entry.blockId, entry]));
}

function classify(opts: {
  base: Map<string, ReconstructedBlock>;
  source: Map<string, ReconstructedBlock>;
  target?: Map<string, ReconstructedBlock>;
}) {
  return classifyChanges({
    baseBlocks: opts.base,
    sourceBlocks: opts.source,
    targetBlocks: opts.target ?? opts.source,
    rootId: ROOT_ID,
    blockDefs: BLOCK_DEFS,
    rootProperties: ROOT_PROPERTIES,
  });
}

function byId(changes: BlockChange[]) {
  return new Map(changes.map((change) => [change.blockId, change]));
}

// ============================================================================
// classifyChanges
// ============================================================================

describe('classifyChanges', () => {
  it('returns no changes for identical snapshots', () => {
    const base = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['a'] }),
      block('a', { properties: { title: 'x' } }),
    );
    const source = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['a'] }),
      block('a', { properties: { title: 'x' } }),
    );

    const { changes, summary } = classify({ base, source });

    expect(changes).toEqual([]);
    expect(summary).toEqual({
      added: 0,
      deleted: 0,
      modified: 0,
      moved: 0,
      reordered: 0,
    });
  });

  it('marks ONLY the inserted block when a child is added at the head (noise regression)', () => {
    const base = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['a', 'b', 'c'] }),
      block('a'),
      block('b'),
      block('c'),
    );
    const source = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['x', 'a', 'b', 'c'] }),
      block('x'),
      block('a'),
      block('b'),
      block('c'),
    );

    const { changes, summary } = classify({ base, source });

    expect(changes).toHaveLength(1);
    expect(changes[0].blockId).toBe('x');
    expect(changes[0].changeTypes).toEqual(['added']);
    expect(changes[0].baseVersion).toBeNull();
    expect(summary).toEqual({
      added: 1,
      deleted: 0,
      modified: 0,
      moved: 0,
      reordered: 0,
    });
  });

  it('marks ONLY the deleted block when a middle child is removed', () => {
    const base = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['a', 'b', 'c'] }),
      block('a'),
      block('b'),
      block('c'),
    );
    const source = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['a', 'c'] }),
      block('a'),
      block('b', { deleted: true }),
      block('c'),
    );

    const { changes, summary } = classify({ base, source });

    expect(changes).toHaveLength(1);
    expect(changes[0].blockId).toBe('b');
    expect(changes[0].changeTypes).toEqual(['deleted']);
    expect(summary).toEqual({
      added: 0,
      deleted: 1,
      modified: 0,
      moved: 0,
      reordered: 0,
    });
  });

  it('marks a true reorder as parent childrenReordered plus one deterministic mover', () => {
    const base = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['a', 'b', 'c'] }),
      block('a'),
      block('b'),
      block('c'),
    );
    const source = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['b', 'a', 'c'] }),
      block('a'),
      block('b'),
      block('c'),
    );

    const { changes, summary } = classify({ base, source });
    const entries = byId(changes);

    expect(changes).toHaveLength(2);
    expect(entries.get(ROOT_ID)?.changeTypes).toEqual(['childrenReordered']);
    // Deterministic LIS tie-break: for base indices [1, 0, 2] the earliest
    // maximal subsequence is [0, 2] (a, c stay) — b is the single mover.
    expect(entries.get('b')?.changeTypes).toEqual(['moved']);
    expect(entries.get('b')?.moved).toEqual({
      kind: 'reordered',
      fromParentId: ROOT_ID,
      fromIndex: 1,
      toParentId: ROOT_ID,
      toIndex: 0,
    });
    expect(entries.has('a')).toBe(false);
    expect(entries.has('c')).toBe(false);
    expect(summary).toEqual({
      added: 0,
      deleted: 0,
      modified: 0,
      moved: 1,
      reordered: 1,
    });
  });

  it('marks a reparented block as moved without entries for either parent', () => {
    const base = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['p1', 'p2'] }),
      block('p1', { type: 'hero', children: ['a', 'b'] }),
      block('p2', { type: 'hero', children: ['c'] }),
      block('a'),
      block('b'),
      block('c'),
    );
    const source = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['p1', 'p2'] }),
      block('p1', { type: 'hero', children: ['b'] }),
      block('p2', { type: 'hero', children: ['c', 'a'] }),
      block('a'),
      block('b'),
      block('c'),
    );

    const { changes, summary } = classify({ base, source });

    expect(changes).toHaveLength(1);
    expect(changes[0].blockId).toBe('a');
    expect(changes[0].changeTypes).toEqual(['moved']);
    expect(changes[0].moved).toEqual({
      kind: 'reparented',
      fromParentId: 'p1',
      fromIndex: 0,
      toParentId: 'p2',
      toIndex: 1,
    });
    expect(summary).toEqual({
      added: 0,
      deleted: 0,
      modified: 0,
      moved: 1,
      reordered: 0,
    });
  });

  it('computes moved indices among ALIVE children only', () => {
    const base = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['dead', 'a', 'b'] }),
      block('dead', { deleted: true }),
      block('a'),
      block('b'),
      block('p2', { type: 'hero', children: [] }),
    );
    const source = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['dead', 'a'] }),
      block('dead', { deleted: true }),
      block('a'),
      block('b'),
      block('p2', { type: 'hero', children: ['b'] }),
    );

    // p2 is not referenced by root in either snapshot; only the reparent of b
    // matters here. Its base index skips the tombstone: alive base children of
    // root are [a, b], so b sits at index 1, not 2.
    const { changes } = classify({ base, source });
    const entry = byId(changes).get('b');

    expect(entry?.moved).toEqual({
      kind: 'reparented',
      fromParentId: ROOT_ID,
      fromIndex: 1,
      toParentId: 'p2',
      toIndex: 0,
    });
  });

  it('never marks the root as moved when a corrupted snapshot lists it as a child', () => {
    const base = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['x'] }),
      block('x', { type: 'hero', children: [] }),
    );
    const source = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['x'] }),
      block('x', { type: 'hero', children: [ROOT_ID] }),
    );

    // Without the root guard the reparent fallback would read the corrupted
    // child reference as null → x and mark the ROOT itself as moved.
    const { changes, summary } = classify({ base, source });

    expect(byId(changes).get(ROOT_ID)).toBeUndefined();
    expect(summary.moved).toBe(0);
  });

  it('collapses duplicate child references instead of fabricating a reorder', () => {
    const base = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['dup', 'dup'] }),
      block('dup'),
    );
    const source = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['dup', 'dup'] }),
      block('dup'),
    );

    // Without dedupe the base-index sequence would be the non-distinct [0, 0],
    // breaking the LIS precondition and yielding a phantom self-move.
    const { changes, summary } = classify({ base, source });

    expect(changes).toEqual([]);
    expect(summary).toEqual({
      added: 0,
      deleted: 0,
      modified: 0,
      moved: 0,
      reordered: 0,
    });
  });

  it('marks a root property change as modified with granular propertyChanges', () => {
    const base = snapshot(
      block(ROOT_ID, { type: 'pages', properties: { title: 'Old' } }),
    );
    const source = snapshot(
      block(ROOT_ID, { type: 'pages', properties: { title: 'New' } }),
    );

    const { changes, summary } = classify({ base, source });

    expect(changes).toHaveLength(1);
    expect(changes[0].changeTypes).toEqual(['modified']);
    expect(changes[0].propertyChanges).toEqual([
      { path: ['title'], kind: 'changed', from: 'Old', to: 'New' },
    ]);
    expect(changes[0].slugChange).toBeUndefined();
    expect(summary.modified).toBe(1);
  });

  it('reports a slug-only root change via slugChange WITHOUT modified', () => {
    const base = snapshot(
      block(ROOT_ID, {
        type: 'pages',
        properties: { title: 'Same', [ROOT_SLUG_PROP]: 'about' },
      }),
    );
    const source = snapshot(
      block(ROOT_ID, {
        type: 'pages',
        properties: { title: 'Same', [ROOT_SLUG_PROP]: 'about-us' },
      }),
    );

    const { changes, summary } = classify({ base, source });

    expect(changes).toHaveLength(1);
    expect(changes[0].blockId).toBe(ROOT_ID);
    expect(changes[0].changeTypes).toEqual([]);
    expect(changes[0].slugChange).toEqual({ from: 'about', to: 'about-us' });
    expect(changes[0].propertyChanges).toBeUndefined();
    expect(summary).toEqual({
      added: 0,
      deleted: 0,
      modified: 0,
      moved: 0,
      reordered: 0,
    });
  });

  it('reports slug + title changes as slugChange AND modified, without a __slug property change', () => {
    const base = snapshot(
      block(ROOT_ID, {
        type: 'pages',
        properties: { title: 'Old', [ROOT_SLUG_PROP]: 'about' },
      }),
    );
    const source = snapshot(
      block(ROOT_ID, {
        type: 'pages',
        properties: { title: 'New', [ROOT_SLUG_PROP]: 'about-us' },
      }),
    );

    const { changes, summary } = classify({ base, source });

    expect(changes).toHaveLength(1);
    expect(changes[0].changeTypes).toEqual(['modified']);
    expect(changes[0].slugChange).toEqual({ from: 'about', to: 'about-us' });
    expect(changes[0].propertyChanges).toEqual([
      { path: ['title'], kind: 'changed', from: 'Old', to: 'New' },
    ]);
    expect(summary.modified).toBe(1);
  });

  it('attaches word-level textDiff to richText property changes', () => {
    const base = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['a'] }),
      block('a', { properties: { body: '<p>Hello world</p>' } }),
    );
    const source = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['a'] }),
      block('a', { properties: { body: '<p>Hello brave world</p>' } }),
    );

    const { changes } = classify({ base, source });
    const entry = byId(changes).get('a');

    expect(entry?.changeTypes).toEqual(['modified']);
    expect(entry?.propertyChanges).toHaveLength(1);
    const change = entry?.propertyChanges?.[0];
    expect(change?.path).toEqual(['body']);
    expect(change?.textDiff).toBeDefined();
    expect(
      change?.textDiff?.some(
        (segment) => segment.type === 'ins' && segment.html.includes('brave'),
      ),
    ).toBe(true);
  });

  it('attaches textDiff to a changed item of a list-of-richText property', () => {
    const base = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['g'] }),
      block('g', {
        type: 'gallery',
        properties: { captions: ['<p>First caption</p>', '<p>Second</p>'] },
      }),
    );
    const source = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['g'] }),
      block('g', {
        type: 'gallery',
        properties: {
          captions: ['<p>First caption edited</p>', '<p>Second</p>'],
        },
      }),
    );

    const { changes } = classify({ base, source });
    const entry = byId(changes).get('g');

    expect(entry?.changeTypes).toEqual(['modified']);
    const change = entry?.propertyChanges?.[0];
    expect(change?.path).toEqual(['captions', 0]);
    expect(change?.kind).toBe('changed');
    expect(change?.textDiff).toBeDefined();
    expect(
      change?.textDiff?.some(
        (segment) => segment.type === 'ins' && segment.html.includes('edited'),
      ),
    ).toBe(true);
  });

  it('reports a type change as modified with typeChange', () => {
    const base = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['a'] }),
      block('a', { type: 'text', properties: { title: 'same' } }),
    );
    const source = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['a'] }),
      block('a', { type: 'hero', properties: { title: 'same' } }),
    );

    const { changes, summary } = classify({ base, source });
    const entry = byId(changes).get('a');

    expect(entry?.changeTypes).toEqual(['modified']);
    expect(entry?.typeChange).toEqual({ from: 'text', to: 'hero' });
    expect(entry?.propertyChanges).toEqual([]);
    expect(summary.modified).toBe(1);
  });

  it('counts an entry with several change types in every summary bucket', () => {
    const base = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['a', 'b', 'c'] }),
      block('a'),
      block('b', { properties: { title: 'old' } }),
      block('c'),
    );
    const source = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['b', 'a', 'c'] }),
      block('a'),
      block('b', { properties: { title: 'new' } }),
      block('c'),
    );

    const { changes, summary } = classify({ base, source });
    const entry = byId(changes).get('b');

    expect(entry?.changeTypes).toEqual(['modified', 'moved']);
    expect(entry?.moved?.kind).toBe('reordered');
    expect(summary).toEqual({
      added: 0,
      deleted: 0,
      modified: 1,
      moved: 1,
      reordered: 1,
    });
  });

  it('passes source/target/base versions through as the raw map objects', () => {
    const baseBlock = block('a', { properties: { title: 'base' } });
    const sourceBlock = block('a', { properties: { title: 'source' } });
    const targetBlock = block('a', { properties: { title: 'target' } });

    const base = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['a'] }),
      baseBlock,
    );
    const source = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['a'] }),
      sourceBlock,
    );
    const target = snapshot(
      block(ROOT_ID, { type: 'pages', children: ['a'] }),
      targetBlock,
    );

    const { changes } = classify({ base, source, target });
    const entry = byId(changes).get('a');

    expect(entry?.sourceVersion).toBe(sourceBlock);
    expect(entry?.targetVersion).toBe(targetBlock);
    expect(entry?.baseVersion).toBe(baseBlock);
  });
});

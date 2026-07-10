import { describe, expect, it, vi } from 'vitest';

import type { TextDiffSegment } from '../types';

import { diffProperties } from '../property-diff';

describe('diffProperties', () => {
  it('returns no changes for deep-equal inputs', () => {
    const props = { title: 'a', meta: { tags: ['x', { y: 1 }] } };
    expect(diffProperties(props, structuredClone(props))).toEqual([]);
  });

  it('reports a scalar change', () => {
    expect(diffProperties({ title: 'a' }, { title: 'b' })).toEqual([
      { path: ['title'], kind: 'changed', from: 'a', to: 'b' },
    ]);
  });

  it('reports added and removed keys', () => {
    expect(diffProperties({ old: 1 }, { fresh: 2 })).toEqual([
      { path: ['old'], kind: 'removed', from: 1 },
      { path: ['fresh'], kind: 'added', to: 2 },
    ]);
  });

  it('recurses into nested objects and accumulates the path', () => {
    expect(
      diffProperties(
        { meta: { seo: { title: 'a', keep: true } } },
        { meta: { seo: { title: 'b', keep: true } } },
      ),
    ).toEqual([
      { path: ['meta', 'seo', 'title'], kind: 'changed', from: 'a', to: 'b' },
    ]);
  });

  it('reports a whole-value change when container types differ', () => {
    expect(diffProperties({ v: ['a'] }, { v: { a: true } })).toEqual([
      { path: ['v'], kind: 'changed', from: ['a'], to: { a: true } },
    ]);
  });

  describe('arrays', () => {
    it('reports an appended item as added at the new index', () => {
      expect(diffProperties({ tags: ['a'] }, { tags: ['a', 'b'] })).toEqual([
        { path: ['tags', 1], kind: 'added', to: 'b' },
      ]);
    });

    it('reports a removed item at the old index', () => {
      expect(diffProperties({ tags: ['a', 'b'] }, { tags: ['a'] })).toEqual([
        { path: ['tags', 1], kind: 'removed', from: 'b' },
      ]);
    });

    it('reports a middle insert without touching aligned neighbours', () => {
      expect(
        diffProperties({ tags: ['a', 'c'] }, { tags: ['a', 'b', 'c'] }),
      ).toEqual([{ path: ['tags', 1], kind: 'added', to: 'b' }]);
    });

    it('recurses into aligned object items using the new index', () => {
      expect(
        diffProperties(
          { items: [{ id: 1, title: 'x' }, { id: 2, title: 'y' }] },
          { items: [{ id: 1, title: 'x' }, { id: 2, title: 'z' }] },
        ),
      ).toEqual([
        { path: ['items', 1, 'title'], kind: 'changed', from: 'y', to: 'z' },
      ]);
    });

    it('recurses into an aligned object pair using the new index even when shifted', () => {
      expect(
        diffProperties(
          { items: ['k', { title: 'x' }] },
          { items: ['a', 'k', { title: 'y' }] },
        ),
      ).toEqual([
        { path: ['items', 0], kind: 'added', to: 'a' },
        { path: ['items', 2, 'title'], kind: 'changed', from: 'x', to: 'y' },
      ]);
    });

    it('reports reordered equal items as removed+added, not a move', () => {
      expect(
        diffProperties({ tags: ['a', 'b', 'c'] }, { tags: ['c', 'a', 'b'] }),
      ).toEqual([
        { path: ['tags', 0], kind: 'added', to: 'c' },
        { path: ['tags', 2], kind: 'removed', from: 'c' },
      ]);
    });

    it('still runs the LCS at the cell-cap boundary (rotation stays added+removed)', () => {
      const from = Array.from({ length: 500 }, (_, i) => `v${i}`);
      const to = [from[499], ...from.slice(0, 499)];

      // No common prefix/suffix, so the mid-section is 500 × 500 = 250 000
      // cells — exactly at the cap. The DP still runs and aligns on the 499
      // common items instead of pairing the rotation positionally.
      expect(diffProperties({ items: from }, { items: to })).toEqual([
        { path: ['items', 0], kind: 'added', to: 'v499' },
        { path: ['items', 499], kind: 'removed', from: 'v499' },
      ]);
    });

    it('skips the LCS past the cell cap but keeps the output shape (positional pairing)', () => {
      const from = Array.from({ length: 5000 }, (_, i) => `old-${i}`);
      const to = Array.from({ length: 5010 }, (_, i) => `new-${i}`);

      const startedAt = performance.now();
      const changes = diffProperties({ items: from }, { items: to });
      const elapsed = performance.now() - startedAt;

      // 5000 positional pairs (changed, path = NEW index) + 10 trailing adds.
      expect(changes).toHaveLength(5010);
      expect(changes[0]).toEqual({
        path: ['items', 0],
        kind: 'changed',
        from: 'old-0',
        to: 'new-0',
      });
      expect(changes[4999]).toEqual({
        path: ['items', 4999],
        kind: 'changed',
        from: 'old-4999',
        to: 'new-4999',
      });
      expect(changes[5000]).toEqual({
        path: ['items', 5000],
        kind: 'added',
        to: 'new-5000',
      });
      expect(changes[5009]).toEqual({
        path: ['items', 5009],
        kind: 'added',
        to: 'new-5009',
      });
      // The 25M-cell quadratic DP is skipped — this must stay fast.
      expect(elapsed).toBeLessThan(1000);
    });
  });

  describe('rich text', () => {
    const segments: TextDiffSegment[] = [
      { type: 'del', html: 'old' },
      { type: 'ins', html: 'new' },
    ];

    it('attaches textDiff when isRichText matches and both sides are strings', () => {
      const diffText = vi.fn(() => segments);
      const changes = diffProperties(
        { body: 'old text', title: 'a' },
        { body: 'new text', title: 'b' },
        { isRichText: (path) => path[0] === 'body', diffText },
      );

      expect(changes).toEqual([
        {
          path: ['body'],
          kind: 'changed',
          from: 'old text',
          to: 'new text',
          textDiff: segments,
        },
        { path: ['title'], kind: 'changed', from: 'a', to: 'b' },
      ]);
      expect(diffText).toHaveBeenCalledOnce();
      expect(diffText).toHaveBeenCalledWith('old text', 'new text');
    });

    it('does not attach textDiff when isRichText returns false', () => {
      const diffText = vi.fn(() => segments);
      const changes = diffProperties(
        { body: 'old text' },
        { body: 'new text' },
        { isRichText: () => false, diffText },
      );

      expect(changes).toEqual([
        { path: ['body'], kind: 'changed', from: 'old text', to: 'new text' },
      ]);
      expect(diffText).not.toHaveBeenCalled();
    });

    it('does not attach textDiff when either side is not a string', () => {
      const diffText = vi.fn(() => segments);
      const changes = diffProperties(
        { body: 1 },
        { body: 'new text' },
        { isRichText: () => true, diffText },
      );

      expect(changes).toEqual([
        { path: ['body'], kind: 'changed', from: 1, to: 'new text' },
      ]);
      expect(diffText).not.toHaveBeenCalled();
    });
  });

  it('orders output deterministically: from-keys first, then added keys in to-order', () => {
    const changes = diffProperties(
      { a: 1, b: 2, keep: true },
      { b: 3, keep: true, d: 4, e: 5 },
    );
    expect(changes.map((c) => [c.path.join('.'), c.kind])).toEqual([
      ['a', 'removed'],
      ['b', 'changed'],
      ['d', 'added'],
      ['e', 'added'],
    ]);
  });
});

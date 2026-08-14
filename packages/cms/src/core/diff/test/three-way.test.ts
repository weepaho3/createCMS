import { describe, expect, it } from 'vitest';

import type { ReconstructedBlock } from '../../blocks/reconstruct-snapshot';

import { analyzeThreeWay } from '../three-way';

function block(overrides: Partial<ReconstructedBlock> = {}): ReconstructedBlock {
  return {
    blockId: 'b1',
    blockVersionId: 'v-base',
    type: 'image',
    properties: { src: '/a.png', alt: 'Alt' },
    children: [],
    deleted: false,
    ...overrides,
  };
}

describe('analyzeThreeWay', () => {
  it('disjoint top-level keys → merge with both changes applied', () => {
    const base = block();
    const source = block({
      blockVersionId: 'v-source',
      properties: { src: '/b.png', alt: 'Alt' },
    });
    const target = block({
      blockVersionId: 'v-target',
      properties: { src: '/a.png', alt: 'New alt' },
    });

    expect(analyzeThreeWay(base, source, target)).toEqual({
      verdict: 'merge',
      type: 'image',
      properties: { src: '/b.png', alt: 'New alt' },
      children: [],
    });
  });

  it('same key changed on both sides → conflict', () => {
    const base = block();
    const source = block({
      blockVersionId: 'v-source',
      properties: { src: '/b.png', alt: 'Alt' },
    });
    const target = block({
      blockVersionId: 'v-target',
      properties: { src: '/c.png', alt: 'Alt' },
    });

    expect(analyzeThreeWay(base, source, target)).toEqual({
      verdict: 'conflict',
    });
  });

  it('key removed by source, different key changed by target → merge without the removed key', () => {
    const base = block({
      properties: { src: '/a.png', alt: 'Alt', caption: 'C' },
    });
    const source = block({
      blockVersionId: 'v-source',
      properties: { src: '/a.png', caption: 'C' },
    });
    const target = block({
      blockVersionId: 'v-target',
      properties: { src: '/a.png', alt: 'Alt', caption: 'New caption' },
    });

    expect(analyzeThreeWay(base, source, target)).toEqual({
      verdict: 'merge',
      type: 'image',
      properties: { src: '/a.png', caption: 'New caption' },
      children: [],
    });
  });

  it('both sides removed the same key → conflict', () => {
    const base = block();
    const source = block({
      blockVersionId: 'v-source',
      properties: { src: '/a.png' },
    });
    const target = block({
      blockVersionId: 'v-target',
      properties: { src: '/a.png' },
    });

    expect(analyzeThreeWay(base, source, target)).toEqual({
      verdict: 'conflict',
    });
  });

  it('identical property outcomes, differing version ids → reuse with source version id', () => {
    const base = block();
    const source = block({
      blockVersionId: 'v-source',
      properties: { src: '/b.png', alt: 'New alt' },
    });
    const target = block({
      blockVersionId: 'v-target',
      properties: { src: '/b.png', alt: 'New alt' },
    });

    expect(analyzeThreeWay(base, source, target)).toEqual({
      verdict: 'reuse',
      blockVersionId: 'v-source',
    });
  });

  it('differing type between source and target → conflict', () => {
    const base = block();
    const source = block({ blockVersionId: 'v-source', type: 'image' });
    const target = block({ blockVersionId: 'v-target', type: 'paragraph' });

    expect(analyzeThreeWay(base, source, target)).toEqual({
      verdict: 'conflict',
    });
  });

  it('deleted on either side → conflict', () => {
    const base = block();
    const deletedSource = block({ blockVersionId: 'v-source', deleted: true });
    const target = block({
      blockVersionId: 'v-target',
      properties: { src: '/a.png', alt: 'New alt' },
    });

    expect(analyzeThreeWay(base, deletedSource, target)).toEqual({
      verdict: 'conflict',
    });

    const source = block({
      blockVersionId: 'v-source',
      properties: { src: '/b.png', alt: 'Alt' },
    });
    const deletedTarget = block({ blockVersionId: 'v-target', deleted: true });

    expect(analyzeThreeWay(base, source, deletedTarget)).toEqual({
      verdict: 'conflict',
    });
  });

  it('missing or deleted base → conflict', () => {
    const source = block({ blockVersionId: 'v-source' });
    const target = block({ blockVersionId: 'v-target' });

    expect(analyzeThreeWay(undefined, source, target)).toEqual({
      verdict: 'conflict',
    });

    const deletedBase = block({ deleted: true });
    expect(analyzeThreeWay(deletedBase, source, target)).toEqual({
      verdict: 'conflict',
    });
  });

  it('children changed by source only, properties changed by target → merge carrying source children and target property change', () => {
    const base = block({ children: ['c1'] });
    const source = block({
      blockVersionId: 'v-source',
      children: ['c1', 'c2'],
    });
    const target = block({
      blockVersionId: 'v-target',
      properties: { src: '/a.png', alt: 'New alt' },
      children: ['c1'],
    });

    expect(analyzeThreeWay(base, source, target)).toEqual({
      verdict: 'merge',
      type: 'image',
      properties: { src: '/a.png', alt: 'New alt' },
      children: ['c1', 'c2'],
    });
  });

  it('children changed by both sides to different arrays → conflict', () => {
    const base = block({ children: ['c1'] });
    const source = block({
      blockVersionId: 'v-source',
      children: ['c1', 'c2'],
    });
    const target = block({
      blockVersionId: 'v-target',
      children: ['c1', 'c3'],
    });

    expect(analyzeThreeWay(base, source, target)).toEqual({
      verdict: 'conflict',
    });
  });

  it('children changed by both sides to the SAME array + disjoint props → merge with that array', () => {
    const base = block({ children: ['c1'] });
    const source = block({
      blockVersionId: 'v-source',
      properties: { src: '/b.png', alt: 'Alt' },
      children: ['c1', 'c2'],
    });
    const target = block({
      blockVersionId: 'v-target',
      properties: { src: '/a.png', alt: 'New alt' },
      children: ['c1', 'c2'],
    });

    expect(analyzeThreeWay(base, source, target)).toEqual({
      verdict: 'merge',
      type: 'image',
      properties: { src: '/b.png', alt: 'New alt' },
      children: ['c1', 'c2'],
    });
  });

  it('nested change inside an object property counts as its top-level key → conflict', () => {
    const base = block({
      properties: { meta: { a: 1, b: 1 } },
    });
    const source = block({
      blockVersionId: 'v-source',
      properties: { meta: { a: 2, b: 1 } },
    });
    const target = block({
      blockVersionId: 'v-target',
      properties: { meta: { a: 1, b: 2 } },
    });

    expect(analyzeThreeWay(base, source, target)).toEqual({
      verdict: 'conflict',
    });
  });
});

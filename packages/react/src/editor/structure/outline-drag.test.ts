import { describe, expect, it } from 'vitest';

import { createEditorStore } from '../core/store';
import { counterGenId, makeDoc, storeSchema } from '../core/store/fixtures';
import { instructionTarget, treeInstruction } from './outline-drag';

const rect = { x: 0, y: 100, width: 300, height: 40 };
const base = { level: 2, indent: 16, canMakeChild: true, isLastInGroup: false };

describe('treeInstruction', () => {
  it('quarters: above, child, below', () => {
    expect(treeInstruction(rect, { x: 100, y: 105 }, base).type).toBe(
      'reorder-above',
    );
    expect(treeInstruction(rect, { x: 100, y: 120 }, base).type).toBe(
      'make-child',
    );
    expect(treeInstruction(rect, { x: 100, y: 135 }, base).type).toBe(
      'reorder-below',
    );
  });

  it('without a child slot the halves decide', () => {
    const leaf = { ...base, canMakeChild: false };
    expect(treeInstruction(rect, { x: 100, y: 115 }, leaf).type).toBe(
      'reorder-above',
    );
    expect(treeInstruction(rect, { x: 100, y: 125 }, leaf).type).toBe(
      'reorder-below',
    );
  });

  it('below the last row, moving left reparents to that level', () => {
    const last = { ...base, isLastInGroup: true };
    expect(treeInstruction(rect, { x: 10, y: 138 }, last)).toEqual({
      type: 'reparent',
      level: 1,
    });
    expect(treeInstruction(rect, { x: 40, y: 138 }, last).type).toBe(
      'reorder-below',
    );
  });
});

describe('instructionTarget', () => {
  const nodes = () =>
    createEditorStore({
      schema: storeSchema,
      initialValue: makeDoc(),
      genId: counterGenId(),
    }).getDoc().nodes;

  it('maps instructions to store targets', () => {
    // root: [h1, sec1[p1]]; section takes heading and paragraph.
    expect(
      instructionTarget(storeSchema, nodes(), 'sec1', 'h1', {
        type: 'make-child',
      }),
    ).toEqual({ parent: { id: 'sec1', slot: 'children' }, index: 1 });
    expect(
      instructionTarget(storeSchema, nodes(), 'p1', 'h1', {
        type: 'reorder-above',
      }),
    ).toEqual({ parent: { id: 'sec1', slot: 'children' }, index: 0 });
    expect(
      instructionTarget(storeSchema, nodes(), 'p1', 'h1', {
        type: 'reparent',
        level: 1,
      }),
    ).toEqual({ parent: { id: 'root_1', slot: 'children' }, index: 2 });
  });

  it('refuses placement violations and drops into itself', () => {
    expect(
      instructionTarget(storeSchema, nodes(), 'h1', 'sec1', {
        type: 'make-child',
      }),
    ).toBeNull();
    expect(
      instructionTarget(storeSchema, nodes(), 'p1', 'sec1', {
        type: 'reorder-below',
      }),
    ).toBeNull();
  });
});

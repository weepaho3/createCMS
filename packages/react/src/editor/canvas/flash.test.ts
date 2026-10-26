// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { changedBlockIds, FLASH_MS, flashBlocks } from './flash';

describe('changedBlockIds', () => {
  it('collects inserted, moved and updated blocks once', () => {
    const parent = { id: 'r', slot: 'children' };
    expect(
      changedBlockIds([
        {
          op: 'insert',
          parent,
          index: 0,
          node: { id: 'a', type: 't', props: {} },
        },
        { op: 'move', id: 'b', parent, index: 1 },
        { op: 'update', id: 'a', patch: { text: 'x' } },
        { op: 'remove', id: 'c' },
      ]),
    ).toEqual(['a', 'b']);
  });
});

describe('flashBlocks', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sets the attribute for FLASH_MS and restarts on a repeat', () => {
    const host = document.createElement('div');
    host.innerHTML = '<p data-editor-block="a"></p>';
    const el = host.firstElementChild!;
    flashBlocks(host, ['a'], 'data-flashed');
    expect(el.hasAttribute('data-flashed')).toBe(true);
    vi.advanceTimersByTime(FLASH_MS - 100);
    flashBlocks(host, ['a'], 'data-flashed');
    vi.advanceTimersByTime(200);
    expect(el.hasAttribute('data-flashed')).toBe(true);
    vi.advanceTimersByTime(FLASH_MS);
    expect(el.hasAttribute('data-flashed')).toBe(false);
  });
});

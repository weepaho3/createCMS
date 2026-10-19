import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FolderTreeState } from './folders';

import { treeNavigate } from '../../tree/core/rows';
import { createTypeAhead, matchTypeAhead } from '../../tree/core/typeahead';
import {
  batchPoliteness,
  createDebouncedAnnouncer,
  createProgressAnnouncer,
  progressValueNow,
} from './announcer';
import {
  ASSET_DRAG_TYPE,
  hasAssetDrag,
  parseAssetDragPayload,
  readAssetDrag,
  writeAssetDrag,
} from './drag';
import {
  collapseBreadcrumbs,
  createFolderTree,
  folderTreeRows,
  loadExpanded,
  moveRejection,
  saveExpanded,
  setFolderChildren,
} from './folders';
import { createRegistry } from './registry';

afterEach(() => {
  vi.useRealTimers();
});

describe('progress announcer', () => {
  it('announces start, at most 5 progress steps and the end', () => {
    const said: string[] = [];
    const progress = createProgressAnnouncer((m) => said.push(m));
    progress.start('start');
    let now = 0;
    for (let p = 0; p <= 100; p += 1) {
      now += 2_000;
      progress.update(p, now, (percent) => `p${percent}`);
    }
    progress.end('end');
    expect(said[0]).toBe('start');
    expect(said[said.length - 1]).toBe('end');
    expect(said.length - 2).toBeLessThanOrEqual(5);
  });

  it('announces a jump over thresholds once and never skips it', () => {
    const said: string[] = [];
    const progress = createProgressAnnouncer((m) => said.push(m));
    progress.start('s');
    progress.update(8, 0, (p) => `p${p}`);
    progress.update(11, 100, (p) => `p${p}`);
    progress.update(80, 200, (p) => `p${p}`);
    progress.update(81, 300, (p) => `p${p}`);
    expect(said).toEqual(['s', 'p80']);
  });

  it('is polite unless the whole batch failed', () => {
    expect(batchPoliteness(1, 12)).toBe('polite');
    expect(batchPoliteness(12, 12)).toBe('assertive');
    expect(progressValueNow(57)).toBe(50);
  });

  it('announces only the last selection change of a burst', () => {
    vi.useFakeTimers();
    const said: string[] = [];
    const announce = createDebouncedAnnouncer((m) => said.push(m), 400);
    announce('1 selected');
    announce('2 selected');
    vi.advanceTimersByTime(399);
    expect(said).toEqual([]);
    announce('3 selected');
    vi.advanceTimersByTime(400);
    expect(said).toEqual(['3 selected']);
  });
});

describe('asset drag payload', () => {
  it('writes the custom type, uri-list, text and DownloadURL', () => {
    const data = new Map<string, string>();
    const transfer = {
      setData: (t: string, v: string) => data.set(t, v),
      effectAllowed: '',
    };
    writeAssetDrag(transfer, [
      {
        id: 'ast_1',
        mimeType: 'image/png',
        name: 'a:b.png',
        url: 'https://cdn/x.png',
      },
    ]);
    expect(JSON.parse(data.get(ASSET_DRAG_TYPE)!)).toEqual({
      ids: ['ast_1'],
      version: 1,
    });
    expect(data.get('text/uri-list')).toBe('https://cdn/x.png');
    expect(data.get('DownloadURL')).toBe('image/png:a_b.png:https://cdn/x.png');
    expect(transfer.effectAllowed).toBe('copyMove');
    expect(readAssetDrag({ getData: (t) => data.get(t) ?? '' })).toEqual({
      ids: ['ast_1'],
      version: 1,
    });
  });

  it('omits DownloadURL for several or private assets and rejects foreign payloads', () => {
    const data = new Map<string, string>();
    writeAssetDrag({ setData: (t, v) => data.set(t, v) }, [
      { id: 'a', mimeType: 'image/png', name: 'a.png', url: null },
      { id: 'b', mimeType: 'image/png', name: 'b.png', url: null },
    ]);
    expect(data.has('DownloadURL')).toBe(false);
    expect(data.get('text/plain')).toBe('a.png\nb.png');
    expect(hasAssetDrag([ASSET_DRAG_TYPE])).toBe(true);
    expect(parseAssetDragPayload('{"ids":["a"],"version":2}')).toBeNull();
    expect(parseAssetDragPayload('not json')).toBeNull();
    expect(parseAssetDragPayload('{"ids":[1,""],"version":1}')).toBeNull();
  });
});

describe('folder tree', () => {
  function tree(): FolderTreeState {
    let state = createFolderTree();
    state = setFolderChildren(state, null, [
      { id: 'a', name: 'Alpha', parentId: null, folderCount: 2 },
      { id: 'b', name: 'Beta', parentId: null, folderCount: 0 },
      { id: 'c', name: 'Gamma', parentId: null, folderCount: 1 },
    ]);
    state = setFolderChildren(state, 'a', [
      { id: 'a1', name: 'One', parentId: 'a', folderCount: 0 },
      { id: 'a2', name: 'Two', parentId: 'a', folderCount: 0 },
    ]);
    return { ...state, expanded: ['a'] };
  }

  it('lists visible rows with level, setsize and posinset', () => {
    expect(
      folderTreeRows(tree()).map((r) => [
        r.id,
        r.level,
        r.setsize,
        r.posinset,
        r.expanded,
      ]),
    ).toEqual([
      ['a', 1, 3, 1, true],
      ['a1', 2, 2, 1, false],
      ['a2', 2, 2, 2, false],
      ['b', 1, 3, 2, false],
      ['c', 1, 3, 3, false],
    ]);
  });

  it('follows the APG tree keys', () => {
    const rows = folderTreeRows(tree());
    expect(treeNavigate(rows, 'a', 'down')).toEqual({ focus: 'a1' });
    expect(treeNavigate(rows, 'a', 'right')).toEqual({ focus: 'a1' });
    expect(treeNavigate(rows, 'a', 'left')).toEqual({ collapse: 'a' });
    expect(treeNavigate(rows, 'a2', 'left')).toEqual({ focus: 'a' });
    expect(treeNavigate(rows, 'c', 'right')).toEqual({ expand: ['c'] });
    expect(treeNavigate(rows, 'b', 'right')).toEqual({});
    expect(treeNavigate(rows, 'b', 'expandSiblings')).toEqual({
      expand: ['c'],
    });
    expect(treeNavigate(rows, 'b', 'end')).toEqual({ focus: 'c' });
  });

  it('rejects moving a folder into itself or a descendant', () => {
    const { nodes } = tree();
    expect(moveRejection(nodes, 'a1', { folderId: 'a' })).toBe('into-itself');
    expect(moveRejection(nodes, 'a', { folderId: 'a' })).toBe('into-itself');
    expect(moveRejection(nodes, null, { folderId: 'a' })).toBe('same-folder');
    expect(moveRejection(nodes, 'b', { folderId: 'a' })).toBeNull();
    expect(moveRejection(nodes, 'b', { assetFolderIds: ['b', 'b'] })).toBe(
      'same-folder',
    );
    expect(
      moveRejection(nodes, 'b', { assetFolderIds: ['a', 'b'] }),
    ).toBeNull();
  });

  it('collapses long breadcrumbs into an overflow menu', () => {
    expect(collapseBreadcrumbs([1, 2, 3])).toEqual({
      head: [1, 2, 3],
      overflow: [],
      tail: [],
    });
    expect(collapseBreadcrumbs([1, 2, 3, 4, 5])).toEqual({
      head: [1],
      overflow: [2, 3],
      tail: [4, 5],
    });
  });

  it('persists the expanded set and survives broken storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => void values.set(k, v),
    };
    saveExpanded(storage, 'k', ['a', 'b']);
    expect(loadExpanded(storage, 'k')).toEqual(['a', 'b']);
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadExpanded(broken, 'k')).toEqual([]);
    expect(() => saveExpanded(broken, 'k', ['a'])).not.toThrow();
    values.set('bad', '{nope');
    expect(loadExpanded(storage, 'bad')).toEqual([]);
  });
});

describe('type-ahead and registry', () => {
  it('builds a buffer within 500 ms and matches labels', () => {
    const typeAhead = createTypeAhead();
    expect(typeAhead.push('h', 0)).toBe('h');
    expect(typeAhead.push('a', 300)).toBe('ha');
    expect(typeAhead.push('x', 1000)).toBe('x');
    const labels = ['Hafen.jpg', 'Hamburg.jpg', 'house.png', 'Zebra.gif'];
    expect(matchTypeAhead(labels, 0, 'ham')).toBe(1);
    expect(matchTypeAhead(labels, 0, 'h')).toBe(1);
    expect(matchTypeAhead(labels, 2, 'h')).toBe(0);
    expect(matchTypeAhead(labels, 0, 'q')).toBe(-1);
  });

  it('registers, replaces by id and unregisters', () => {
    const registry = createRegistry<{ id: string; v: number }>();
    const calls: number[] = [];
    registry.subscribe(() => calls.push(registry.list().length));
    const off = registry.register({ id: 'a', v: 1 });
    registry.register({ id: 'b', v: 2 });
    registry.register({ id: 'a', v: 3 });
    expect(registry.list().map((x) => [x.id, x.v])).toEqual([
      ['a', 3],
      ['b', 2],
    ]);
    off();
    expect(registry.list()).toHaveLength(2);
    expect(calls).toEqual([1, 2, 2]);
  });
});

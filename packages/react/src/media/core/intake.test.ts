import { describe, expect, it } from 'vitest';

import type { EntryLike } from './intake';

import {
  acceptsFile,
  collectDrop,
  dragHasFiles,
  isSystemFile,
  isTextInput,
  normalizeDrop,
  normalizeInput,
  normalizePaste,
  readDrop,
  validate,
  validateBatch,
} from './intake';

function file(name: string, size = 10, type = 'image/png'): File {
  return new File([new Uint8Array(size)], name, { type });
}

/** A fake directory entry whose reader returns at most 100 entries per call, like Chromium. */
function dir(path: string, children: EntryLike[]): EntryLike {
  return {
    isFile: false,
    isDirectory: true,
    name: path.slice(path.lastIndexOf('/') + 1),
    fullPath: `/${path}`,
    createReader() {
      let offset = 0;
      return {
        readEntries(success) {
          const batch = children.slice(offset, offset + 100);
          offset += batch.length;
          queueMicrotask(() => success(batch));
        },
      };
    },
  };
}

function fileEntry(path: string, size = 10): EntryLike {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath: `/${path}`,
    file: (success) => queueMicrotask(() => success(file(name, size))),
  };
}

/** 12 subfolders with 340 files in total, plus .DS_Store files. */
function bigFolder(): EntryLike {
  const subs: EntryLike[] = [];
  let made = 0;
  for (let s = 1; s <= 12; s++) {
    const count =
      s === 1 ? 150 : Math.floor(190 / 11) + (s <= (190 % 11) + 1 ? 1 : 0);
    const children: EntryLike[] = [fileEntry(`Shoot/sub${s}/.DS_Store`)];
    for (let i = 0; i < count && made < 340; i++, made++) {
      children.push(fileEntry(`Shoot/sub${s}/img${i}.jpg`));
    }
    subs.push(dir(`Shoot/sub${s}`, children));
  }
  return dir('Shoot', [
    ...subs,
    fileEntry('Shoot/.DS_Store'),
    fileEntry('Shoot/Thumbs.db'),
  ]);
}

describe('normalizeDrop', () => {
  it('reads a folder of 340 files in 12 subfolders, more than 100 per level', async () => {
    const result = await normalizeDrop({
      items: [
        {
          kind: 'file',
          getAsFile: () => null,
          webkitGetAsEntry: () => bigFolder(),
        },
      ],
    });
    expect(result.files).toHaveLength(340);
    expect(result.folders).toHaveLength(13);
    expect(result.folders[0]).toBe('Shoot');
    expect(result.skippedSystem).toBe(14);
    expect(result.truncated).toBeNull();
    expect(result.files[0].relativePath).toMatch(
      /^Shoot\/sub\d+\/img\d+\.jpg$/,
    );
  });

  it('collects every entry before the first await', () => {
    let reads = 0;
    const items = [
      {
        kind: 'file',
        getAsFile: () => null,
        getAsEntry: () => (reads++, fileEntry('a.jpg')),
      },
      { kind: 'string', getAsFile: () => null },
      { kind: 'file', getAsFile: () => file('b.jpg') },
    ];
    const snapshot = collectDrop({ items });
    expect(reads).toBe(1);
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.files.map((f) => f.name)).toEqual(['b.jpg']);
  });

  it('falls back to the file list', async () => {
    const result = await normalizeDrop({
      files: [file('a.png'), file('.DS_Store')],
    });
    expect(result.files.map((f) => f.relativePath)).toEqual(['a.png']);
    expect(result.skippedSystem).toBe(1);
  });

  it('stops at the file, byte and depth limits', async () => {
    const drop = () => ({ entries: [bigFolder()], files: [] });
    expect((await readDrop(drop(), { maxFiles: 20 })).files).toHaveLength(20);
    expect((await readDrop(drop(), { maxFiles: 20 })).truncated).toBe('files');
    const bytes = await readDrop(drop(), { maxTotalBytes: 55 });
    expect(bytes.files).toHaveLength(5);
    expect(bytes.truncated).toBe('bytes');
    const deep = dir('a', [
      dir('a/b', [dir('a/b/c', [fileEntry('a/b/c/x.png')])]),
    ]);
    const shallow = await readDrop(
      { entries: [deep], files: [] },
      { maxDepth: 1 },
    );
    expect(shallow.files).toHaveLength(0);
    expect(shallow.truncated).toBe('depth');
  });

  it('reports progress while reading', async () => {
    const seen: number[] = [];
    await readDrop(
      { entries: [bigFolder()], files: [] },
      { onProgress: (n) => seen.push(n) },
    );
    expect(seen[seen.length - 1]).toBe(340);
  });
});

describe('normalizeInput', () => {
  it('rebuilds folders from webkitRelativePath', async () => {
    const withPath = (path: string) => {
      const f = file(path.slice(path.lastIndexOf('/') + 1));
      Object.defineProperty(f, 'webkitRelativePath', { value: path });
      return f;
    };
    const result = await normalizeInput([
      withPath('Trip/day1/a.jpg'),
      withPath('Trip/day1/b.jpg'),
      withPath('Trip/.DS_Store'),
      withPath('Trip/day2/c.jpg'),
    ]);
    expect(result.folders).toEqual(['Trip', 'Trip/day1', 'Trip/day2']);
    expect(result.files.map((f) => f.relativePath)).toEqual([
      'Trip/day1/a.jpg',
      'Trip/day1/b.jpg',
      'Trip/day2/c.jpg',
    ]);
    expect(result.skippedSystem).toBe(1);
  });
});

describe('paste, system files and validation', () => {
  it('renames screenshots with a timestamp', () => {
    const [renamed, kept] = normalizePaste(
      { files: [file('image.png'), file('logo.svg', 10, 'image/svg+xml')] },
      new Date(2026, 9, 14, 10, 15, 0),
    );
    expect(renamed.name).toBe('pasted-2026-10-14-101500.png');
    expect(renamed.type).toBe('image/png');
    expect(kept.name).toBe('logo.svg');
  });

  it('recognizes system files and text inputs', () => {
    expect(isSystemFile('a/__MACOSX/b.jpg')).toBe(true);
    expect(isSystemFile('desktop.ini')).toBe(true);
    expect(isSystemFile('.hidden')).toBe(true);
    expect(isSystemFile('photo.jpg')).toBe(false);
    expect(isTextInput({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(isTextInput({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextInput({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(dragHasFiles(['text/plain', 'Files'])).toBe(true);
  });

  it('validates type, size, dimensions and aspect', () => {
    const png = file('a.png', 2000);
    expect(acceptsFile('image/*,.pdf', png)).toBe(true);
    expect(validate(png, { accept: '.pdf' })).toBe('type');
    expect(validate(png, { maxSize: 1000 })).toBe('size');
    expect(validate(png, { minWidth: 1200 }, { width: 800, height: 600 })).toBe(
      'dimensions',
    );
    expect(validate(png, { aspect: 16 / 9 }, { width: 800, height: 600 })).toBe(
      'aspect',
    );
    expect(
      validate(png, { aspect: 4 / 3 }, { width: 800, height: 600 }),
    ).toBeNull();
    const { accepted, rejected } = validateBatch(
      [
        { file: png },
        { file: file('b.png') },
        { file: file('c.txt', 1, 'text/plain') },
      ],
      { accept: 'image/*', maxFiles: 1 },
    );
    expect(accepted).toHaveLength(1);
    expect(rejected.map((r) => r.reason)).toEqual(['count', 'type']);
  });
});

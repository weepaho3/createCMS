import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaAsset, MediaClient } from './types';

import {
  assetFacts,
  assetPatch,
  detailValues,
  isDirty,
  setDraftField,
} from './detail';
import { createDownloadQueue } from './downloads';
import {
  cropStyles,
  defaultCrop,
  focalFromPointer,
  focalObjectPosition,
  focalPercent,
  isFullCrop,
  normalizeCrop,
  nudgeFocal,
  zoomCrop,
} from './image-edit';
import {
  acceptAltSuggestion,
  altStateOf,
  replaceImageAsset,
  satisfiesAlt,
  setAlt,
  setDecorative,
  suggestAlt,
} from './image-field';
import {
  aspectLabel,
  canConfirmPicker,
  intakeConstraintsOf,
  pickerDisabledReason,
  pickerFilter,
  replaceWarnings,
} from './picker';
import {
  previewKindOf,
  previewNeighbours,
  previewStep,
  stepZoom,
  swipeOf,
  toggleZoom,
} from './preview';
import { createMediaStore } from './store';
import { createLongPress } from './touch';
import {
  crc32,
  makeZip,
  manifestCsv,
  predictZipLength,
  sanitizeZipPath,
  uniqueZipPaths,
} from './zip';

afterEach(() => {
  vi.useRealTimers();
});

function asset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 'a1',
    slug: 'hero',
    originalName: 'hero.jpg',
    mimeType: 'image/jpeg',
    size: 2_000_000,
    width: 2000,
    height: 1000,
    objectKey: 'a1/hero.jpg',
    url: null,
    deliveryUrl: '/api/cms/media/asset/a1',
    status: 'private',
    provenance: 'captured',
    metadata: {
      description: 'Team',
      rights: { credit: 'Jo', license: 'CC-BY' },
      provenanceSource: 'iptc',
      seoKeywords: 'team',
    },
    folderId: null,
    variantOf: null,
    uploadedBy: 'usr_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('preview', () => {
  it('maps MIME types to renderers', () => {
    expect(previewKindOf('image/png')).toBe('image');
    expect(previewKindOf('image/svg+xml')).toBe('svg');
    expect(previewKindOf('video/mp4')).toBe('video');
    expect(previewKindOf('audio/mpeg')).toBe('audio');
    expect(previewKindOf('application/pdf')).toBe('pdf');
    expect(previewKindOf('application/zip')).toBe('fallback');
  });

  it('steps without wrapping and preloads neighbours', () => {
    const ids = ['a', 'b', 'c'];
    expect(previewStep(ids, 'b', 1)).toBe('c');
    expect(previewStep(ids, 'c', 1)).toBeNull();
    expect(previewStep(ids, 'a', -1)).toBeNull();
    expect(previewNeighbours(ids, 'b')).toEqual(['a', 'c']);
  });

  it('zooms within limits and toggles fit and 100 percent', () => {
    expect(stepZoom(1, 'out')).toBe(1);
    expect(stepZoom(1, 'in')).toBeCloseTo(1.25);
    expect(stepZoom(5, 'reset')).toBe(1);
    expect(toggleZoom(1, 3)).toBe(3);
    expect(toggleZoom(3, 3)).toBe(1);
  });

  it('detects swipes, mirrored for RTL, and never while zoomed', () => {
    expect(swipeOf(-80, 5, 300)).toBe('next');
    expect(swipeOf(80, 5, 300)).toBe('prev');
    expect(swipeOf(80, 5, 300, { rtl: true })).toBe('next');
    expect(swipeOf(5, 90, 300)).toBe('close');
    expect(swipeOf(-20, 0, 20)).toBe('next');
    expect(swipeOf(-20, 0, 400)).toBeNull();
    expect(swipeOf(-80, 0, 300, { zoomed: true })).toBeNull();
  });
});

describe('detail', () => {
  it('reads values and facts and keeps custom metadata apart', () => {
    const values = detailValues(asset());
    expect(values).toMatchObject({
      originalName: 'hero.jpg',
      description: 'Team',
      rights: { credit: 'Jo', license: 'CC-BY' },
      provenance: 'captured',
      custom: { seoKeywords: 'team' },
    });
    expect(assetFacts(asset())).toMatchObject({
      width: 2000,
      provenanceSource: 'iptc',
      c2pa: null,
    });
  });

  it('builds a patch of changes, clearing with null', () => {
    const a = asset();
    let draft = setDraftField({}, 'description', 'Team');
    expect(isDirty(detailValues(a), draft)).toBe(false);
    expect(assetPatch(a, draft)).toBeNull();
    draft = setDraftField(draft, 'rights.credit', '');
    draft = setDraftField(draft, 'rights.copyright', '© Studio');
    draft = setDraftField(draft, 'provenance', 'ai_edited');
    draft = setDraftField(draft, 'custom.seoKeywords', '');
    draft = setDraftField(draft, 'originalName', '  ');
    expect(assetPatch(a, draft)).toEqual({
      provenance: 'ai_edited',
      metadata: {
        rights: { credit: null, copyright: '© Studio' },
        seoKeywords: null,
      },
    });
  });

  it('saves with expectedUpdatedAt and resolves a conflict', async () => {
    const newer = asset({
      updatedAt: '2026-01-03T00:00:00.000Z',
      originalName: 'renamed.jpg',
    });
    const updateAsset = vi
      .fn()
      .mockRejectedValueOnce({
        code: 'ASSET_CONFLICT',
        body: { code: 'ASSET_CONFLICT', data: { asset: newer } },
      })
      .mockImplementationOnce(async ({ body }) => ({
        asset: {
          ...newer,
          metadata: {
            ...newer.metadata,
            description: body.patch.metadata.description,
          },
          updatedAt: '2026-01-04T00:00:00.000Z',
        },
      }));
    const client = {
      listAssets: vi.fn(async () => ({
        assets: [asset()],
        total: 1,
        hasMore: false,
        nextCursor: null,
      })),
      listFolders: vi.fn(async () => ({ folders: [] })),
      updateAsset,
    } as unknown as MediaClient;
    const store = createMediaStore({ client });
    await store.dispatch({ type: 'load' });
    await store.dispatch({ type: 'openDetail', id: 'a1' });
    await store.dispatch({
      type: 'setDetailField',
      field: 'description',
      value: 'Workshop',
    });
    expect(store.getState().detail.dirty).toBe(true);
    const first = await store.dispatch({ type: 'saveDetail' });
    expect(first).toMatchObject({ ok: false, code: 'ASSET_CONFLICT' });
    expect(store.getState().detail.conflict?.originalName).toBe('renamed.jpg');
    expect(updateAsset.mock.calls[0][0].body.expectedUpdatedAt).toBe(
      '2026-01-02T00:00:00.000Z',
    );
    await store.dispatch({ type: 'resolveDetailConflict', keep: 'mine' });
    expect(updateAsset.mock.calls[1][0].body.expectedUpdatedAt).toBe(
      '2026-01-03T00:00:00.000Z',
    );
    expect(store.getState().detail).toMatchObject({
      dirty: false,
      conflict: null,
    });
    expect(store.getState().collection.byId.a1.updatedAt).toBe(
      '2026-01-04T00:00:00.000Z',
    );
  });

  it('opens the preview over the collection order and steps', async () => {
    const client = {
      listAssets: vi.fn(async () => ({
        assets: [asset(), asset({ id: 'a2' })],
        total: 2,
        hasMore: false,
        nextCursor: null,
      })),
      listFolders: vi.fn(async () => ({ folders: [] })),
    } as unknown as MediaClient;
    const store = createMediaStore({ client });
    await store.dispatch({ type: 'load' });
    await store.dispatch({ type: 'openPreview', id: 'a1' });
    await store.dispatch({
      type: 'previewZoom',
      zoom: 2,
      pan: { x: 10, y: 0 },
    });
    expect(store.getState().preview).toMatchObject({
      ids: ['a1', 'a2'],
      zoom: 2,
    });
    await store.dispatch({ type: 'previewStep', delta: 1 });
    expect(store.getState().preview).toMatchObject({
      openId: 'a2',
      zoom: 1,
      pan: { x: 0, y: 0 },
    });
    expect(
      await store.dispatch({ type: 'previewStep', delta: 1 }),
    ).toMatchObject({ ok: false });
  });
});

describe('focal point and crop', () => {
  it('moves by keyboard and pointer and labels in percent', () => {
    expect(nudgeFocal({ x: 0.5, y: 0.5 }, 'right')).toEqual({
      x: 0.51,
      y: 0.5,
    });
    expect(nudgeFocal({ x: 0.95, y: 0.5 }, 'right', true)).toEqual({
      x: 1,
      y: 0.5,
    });
    expect(
      focalFromPointer(142, 30, { left: 100, top: 0, width: 100, height: 100 }),
    ).toEqual({ x: 0.42, y: 0.3 });
    expect(focalPercent({ x: 0.424, y: 0.3 })).toEqual({ x: 42, y: 30 });
    expect(focalObjectPosition({ x: 0.42, y: 0.3 })).toBe('42% 30%');
    expect(focalObjectPosition(null)).toBe('50% 50%');
  });

  it('defaults a crop to the largest rect of the aspect around the focal point', () => {
    // 2000 x 1000 image, square crop: 1000 px wide = 0.5 of the width.
    expect(defaultCrop(1, 2000, 1000, { x: 0.9, y: 0.5 })).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 1,
    });
    expect(defaultCrop(1, 2000, 1000, { x: 0.3, y: 0.5 })).toEqual({
      x: 0.05,
      y: 0,
      width: 0.5,
      height: 1,
    });
    // Wider than the image: full width, cropped height.
    const wide = defaultCrop(4, 2000, 1000);
    expect(wide.width).toBe(1);
    expect(wide.height).toBe(0.5);
    expect(isFullCrop(defaultCrop(2, 2000, 1000))).toBe(true);
  });

  it('normalizes, zooms and styles crops in fractions', () => {
    expect(normalizeCrop({ x: -1, y: 0.9, width: 2, height: 0.5 })).toEqual({
      x: 0,
      y: 0.5,
      width: 1,
      height: 0.5,
    });
    expect(zoomCrop({ x: 0, y: 0, width: 1, height: 1 }, 2)).toEqual({
      x: 0.25,
      y: 0.25,
      width: 0.5,
      height: 0.5,
    });
    const styles = cropStyles(
      { x: 0.25, y: 0, width: 0.5, height: 1 },
      { width: 2000, height: 1000 },
    );
    expect(styles.objectViewBox).toBe('inset(0% 25% 0% 25%)');
    expect(styles.image).toMatchObject({
      width: '200%',
      height: '100%',
      left: '-50%',
      top: '0%',
    });
    expect(styles.aspectRatio).toBe(1);
  });
});

describe('picker constraints', () => {
  const constraints = {
    mode: 'multiple' as const,
    max: 2,
    accept: ['image/*'],
    maxBytes: 5_000_000,
    minWidth: 1200,
    minHeight: 630,
  };

  it('locks unsuitable assets with the same reasons as intake', () => {
    expect(pickerDisabledReason(asset(), constraints)).toBeNull();
    expect(
      pickerDisabledReason(
        asset({ mimeType: 'application/pdf', originalName: 'a.pdf' }),
        constraints,
      ),
    ).toBe('type');
    expect(pickerDisabledReason(asset({ size: 9_000_000 }), constraints)).toBe(
      'size',
    );
    expect(
      pickerDisabledReason(asset({ width: 800, height: 600 }), constraints),
    ).toBe('dimensions');
    expect(
      pickerDisabledReason(asset({ width: null, height: null }), constraints),
    ).toBe('dimensions');
    expect(
      pickerDisabledReason(asset({ width: 2000, height: 2000 }), {
        mode: 'single',
        aspect: { ratio: 16 / 9 },
      }),
    ).toBe('aspect');
    expect(
      pickerDisabledReason(asset({ id: 'x' }), constraints, ['a', 'b']),
    ).toBe('max');
    expect(
      pickerDisabledReason(asset({ id: 'a' }), constraints, ['a', 'b']),
    ).toBeNull();
    expect(intakeConstraintsOf(constraints)).toMatchObject({
      accept: 'image/*',
      maxSize: 5_000_000,
      minWidth: 1200,
      maxFiles: 2,
    });
    expect(
      pickerFilter({
        mode: 'single',
        accept: ['image/*', '.pdf'],
        folderId: null,
      }),
    ).toEqual({
      sort: 'created_desc',
      mime: ['image/*'],
      folderId: null,
    });
  });

  it('confirms within min and max', () => {
    expect(canConfirmPicker({ mode: 'single' }, ['a'])).toBe(true);
    expect(canConfirmPicker({ mode: 'single' }, [])).toBe(false);
    expect(canConfirmPicker({ mode: 'multiple', min: 2 }, ['a'])).toBe(false);
    expect(
      canConfirmPicker({ mode: 'multiple', min: 2, max: 3 }, ['a', 'b']),
    ).toBe(true);
  });

  it('warns before a replace about type, aspect and usage', () => {
    expect(
      replaceWarnings(
        asset(),
        { type: 'image/webp', width: 1600, height: 1200 },
        { roots: 14 },
      ),
    ).toEqual([
      { code: 'type', from: 'image/jpeg', to: 'image/webp' },
      { code: 'aspect', from: 2, to: 4 / 3 },
      { code: 'usage', roots: 14 },
    ]);
    expect(
      replaceWarnings(asset(), {
        type: 'image/jpeg',
        width: 4000,
        height: 2000,
      }),
    ).toEqual([]);
    expect(aspectLabel(4 / 3)).toBe('4:3');
    expect(aspectLabel(1.85)).toBe('1.85:1');
  });
});

describe('image field', () => {
  it('tracks alt state and never lets a suggestion overwrite text', () => {
    expect(altStateOf('a1')).toBe('missing');
    const typed = setAlt('a1', 'Team at the workshop');
    expect(typed).toEqual({
      assetId: 'a1',
      alt: 'Team at the workshop',
      altSource: 'user',
    });
    expect(acceptAltSuggestion(typed, 'Something else')).toBe(typed);
    expect(acceptAltSuggestion('a1', ' A team ')).toEqual({
      assetId: 'a1',
      alt: 'A team',
      altSource: 'ai-suggested',
    });
    const decorative = setDecorative(typed, true);
    expect(altStateOf(decorative)).toBe('decorative');
    expect(acceptAltSuggestion(decorative, 'x')).toBe(decorative);
    expect(satisfiesAlt('a1', true)).toBe(false);
    expect(satisfiesAlt(decorative, true)).toBe(true);
  });

  it('keeps alt and caption when the asset is replaced but drops the pin and crop', () => {
    expect(
      replaceImageAsset(
        {
          assetId: 'a1',
          alt: 'x',
          caption: 'c',
          revisionId: 'r1',
          crop: { x: 0, y: 0, width: 0.5, height: 1 },
        },
        'a2',
      ),
    ).toEqual({ assetId: 'a2', alt: 'x', caption: 'c' });
  });

  it('asks suggesters in order and skips failures', async () => {
    const failing = {
      suggest: vi.fn(async () => Promise.reject(new Error('offline'))),
    };
    const empty = { suggest: vi.fn(async () => null) };
    const working = { suggest: vi.fn(async () => '  Two people at a desk ') };
    expect(
      await suggestAlt([failing, empty, working], {
        assetId: 'a1',
        context: { locale: 'en' },
      }),
    ).toBe('Two people at a desk');
  });
});

/** Reads the central directory of a ZIP: names, sizes, CRCs. */
function readZip(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: { name: string; size: number; crc: number; offset: number }[] =
    [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    entries.push({
      crc: view.getUint32(at + 16, true),
      size: view.getUint32(at + 24, true),
      offset: view.getUint32(at + 42, true),
      name: new TextDecoder().decode(
        bytes.subarray(at + 46, at + 46 + nameLength),
      ),
    });
    at += 46 + nameLength + extraLength;
  }
  return entries;
}

describe('zip', () => {
  it('computes CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a stored archive of exactly the predicted length', async () => {
    const files = [
      { name: 'Brand/a.txt', bytes: new TextEncoder().encode('alpha') },
      {
        name: 'Grüße.bin',
        bytes: new Uint8Array(100_000).map((_, i) => i % 7),
      },
    ];
    const bytes = new Uint8Array(
      await new Response(
        makeZip(files.map((f) => ({ name: f.name, input: f.bytes }))),
      ).arrayBuffer(),
    );
    expect(bytes.length).toBe(
      predictZipLength(
        files.map((f) => ({ name: f.name, size: f.bytes.length })),
      ),
    );
    const entries = readZip(bytes);
    expect(entries.map((e) => [e.name, e.size])).toEqual([
      ['Brand/a.txt', 5],
      ['Grüße.bin', 100_000],
    ]);
    expect(entries[1].crc).toBe(crc32(files[1].bytes));
  });

  it('cleans and deduplicates paths and escapes the manifest', () => {
    expect(sanitizeZipPath('../../etc/passwd')).toBe('etc/passwd');
    expect(sanitizeZipPath('/a\\b/CON.txt')).toBe('a/b/_CON.txt');
    expect(sanitizeZipPath('name. ')).toBe('name');
    expect(sanitizeZipPath('a\u0000b?.jpg')).toBe('ab_.jpg');
    expect(sanitizeZipPath('..')).toBe('_');
    expect(
      uniqueZipPaths(['x/a.jpg', 'x/A.jpg', 'y/a.jpg', 'x/a.jpg']),
    ).toEqual(['x/a.jpg', 'x/A (2).jpg', 'y/a.jpg', 'x/a (3).jpg']);
    expect(
      manifestCsv([{ id: 'a1', path: '=cmd|"x"', size: 3, usage: 2 }]),
    ).toBe(`id,path,size,usage\r\na1,"'=cmd|""x""",3,2\r\n`);
  });
});

describe('download queue', () => {
  function sinkInto(chunks: Uint8Array[]) {
    return async () => ({
      kind: 'blob' as const,
      writable: new WritableStream<Uint8Array>({
        write: (c) => void chunks.push(c),
      }),
      finish: async () => {},
    });
  }

  it('signs in batches, fetches, archives in order and reports progress', async () => {
    const files: Record<string, Uint8Array> = {
      a: new TextEncoder().encode('first file'),
      b: new TextEncoder().encode('second'),
      c: new Uint8Array(0),
    };
    const sign = vi.fn(async (ids: string[]) => ({
      items: ids
        .filter((id) => id !== 'c')
        .map((id) => ({
          id,
          url: `https://cdn/${id}`,
          size: files[id].length,
          name: id,
        })),
    }));
    const fetchMock = vi.fn(
      async (url: string | URL | Request) =>
        new Response(
          files[
            (typeof url === 'string'
              ? url
              : url instanceof URL
                ? url.href
                : url.url
            ).slice(-1)
          ] as BodyInit,
        ),
    );
    const chunks: Uint8Array[] = [];
    const queue = createDownloadQueue({
      sign,
      fetch: fetchMock as typeof fetch,
      sink: sinkInto(chunks),
    });
    const job = await queue.download(
      [
        { id: 'a', name: 'logo.png', size: 10, folderPath: 'Brand' },
        { id: 'b', name: 'logo.png', size: 6, folderPath: 'Brand' },
        { id: 'c', name: 'gone.png', size: 0 },
      ],
      { name: 'export', manifest: true },
    );
    expect(job.status).toBe('success');
    expect(job.name).toBe('export.zip');
    expect(job.items.map((i) => [i.path, i.status])).toEqual([
      ['Brand/logo.png', 'success'],
      ['Brand/logo (2).png', 'success'],
      ['gone.png', 'skipped'],
    ]);
    expect(sign).toHaveBeenCalledTimes(1);
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    expect(job.total).toBe(bytes.length);
    expect(readZip(bytes).map((e) => e.name)).toEqual([
      'Brand/logo.png',
      'Brand/logo (2).png',
      'manifest.csv',
    ]);
  });

  it('aborts every fetch and the sink on cancel', async () => {
    const sign = async (ids: string[]) => ({
      items: ids.map((id) => ({ id, url: id, size: 1, name: id })),
    });
    const fetchMock = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const queue = createDownloadQueue({
      sign,
      fetch: fetchMock as typeof fetch,
      sink: sinkInto([]),
    });
    const running = queue.download([{ id: 'a', name: 'a', size: 1 }], {
      name: 'x',
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    queue.cancel();
    const job = await running;
    expect(job.status).toBe('aborted');
  });

  const many = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      id: `a${i}`,
      name: `f${i}.png`,
      size: 10,
    }));

  it('writes archives of 500 files and more on the server and polls them', async () => {
    const sign = vi.fn();
    const states = [
      { status: 'running' as const, loaded: 100, url: null },
      { status: 'ready' as const, loaded: 5000, url: 'https://s3/x.zip' },
    ];
    const exporter = {
      create: vi.fn(async () => ({
        id: 'mex_1',
        status: 'pending' as const,
        skipped: [],
        loaded: 0,
        total: 5000,
        url: null,
        error: null,
      })),
      get: vi.fn(async () => ({
        id: 'mex_1',
        skipped: ['a3'],
        total: 5000,
        error: null,
        ...states.shift()!,
      })),
    };
    const queue = createDownloadQueue({
      sign,
      exporter,
      sleep: async () => {},
    });
    const job = await queue.download(many(500), { name: 'all', flatten: true });

    expect(sign).not.toHaveBeenCalled();
    expect(exporter.create).toHaveBeenCalledWith(
      many(500).map((a) => a.id),
      { name: 'all.zip', flatten: true, manifest: undefined },
    );
    expect(exporter.get).toHaveBeenCalledTimes(2);
    expect(job).toMatchObject({
      status: 'success',
      sink: 'server',
      loaded: 5000,
    });
    expect(job.items.find((i) => i.id === 'a3')?.status).toBe('skipped');
    expect(job.items.filter((i) => i.status === 'success')).toHaveLength(499);
  });

  it('keeps small archives in the browser and deletes a cancelled server export', async () => {
    const exporter = {
      create: vi.fn(async () => ({
        id: 'mex_2',
        status: 'running' as const,
        skipped: [],
        loaded: 0,
        total: 1,
        url: null,
        error: null,
      })),
      get: vi.fn(),
      delete: vi.fn(async () => {}),
    };
    const small = createDownloadQueue({
      sign: async () => ({ items: [] }),
      exporter,
      sink: sinkInto([]),
    });
    await small.download(many(2), { name: 'x' });
    expect(exporter.create).not.toHaveBeenCalled();

    const queue = createDownloadQueue({
      sign: async () => ({ items: [] }),
      exporter,
      sleep: (_ms, signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(signal.reason)),
        ),
    });
    const running = queue.download(many(600), { name: 'x' });
    await vi.waitFor(() => expect(exporter.create).toHaveBeenCalled());
    queue.cancel();
    expect((await running).status).toBe('aborted');
    expect(exporter.delete).toHaveBeenCalledWith('mex_2');
  });
});

describe('long press', () => {
  it('fires after 500 ms for touch, not after movement or for a mouse', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    const press = createLongPress(fired);
    press.down(0, 0, 'touch');
    vi.advanceTimersByTime(499);
    expect(fired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fired).toHaveBeenCalledTimes(1);
    expect(press.consumeClick()).toBe(true);
    expect(press.consumeClick()).toBe(false);
    press.down(0, 0, 'touch');
    press.move(0, 15);
    vi.advanceTimersByTime(600);
    press.down(0, 0, 'mouse');
    vi.advanceTimersByTime(600);
    expect(fired).toHaveBeenCalledTimes(1);
  });
});

describe('purge', () => {
  it('removes purged assets, keeps skipped ones and offers no undo', async () => {
    const purgeAssets = vi.fn(async () => ({
      purgedIds: ['a1'],
      skipped: [{ id: 'a2', reason: 'STORAGE_ERROR' }],
      objectsDeleted: 3,
      danglingUsages: [],
    }));
    const client = {
      listAssets: vi.fn(async () => ({
        assets: [asset(), asset({ id: 'a2' })],
        total: 2,
        hasMore: false,
        nextCursor: null,
      })),
      listFolders: vi.fn(async () => ({ folders: [] })),
      purgeAssets,
    } as unknown as MediaClient;
    const store = createMediaStore({ client });
    await store.dispatch({ type: 'load' });
    const result = await store.dispatch({
      type: 'purge',
      ids: ['a1', 'a2'],
      reason: 'gdpr-erasure',
    });
    expect(purgeAssets).toHaveBeenCalledWith({
      body: { assetIds: ['a1', 'a2'], reason: 'gdpr-erasure' },
    });
    expect(result).toMatchObject({ ok: true, skipped: ['a2'] });
    expect(result.ok && result.undo).toBeFalsy();
    expect(store.getState().collection.ids).toEqual(['a2']);
  });
});

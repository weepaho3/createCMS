import { afterEach, describe, expect, it } from 'vitest';

import { setupTestCMS } from '../../../test-utils/cms';
import {
  imgproxySignature,
  imgproxyTransform,
  TransformNotAllowedError,
} from '../transform';

// `secret` and `hello`, the pair of imgproxy's signing example.
const KEY = '736563726574';
const SALT = '68656C6C6F';

describe('imgproxy URLs', () => {
  it('signs like imgproxy', async () => {
    expect(
      await imgproxySignature(
        KEY,
        SALT,
        '/rs:fill:300:400:0/g:sm/aHR0cDovL2V4YW1w/bGUuY29tL2ltYWdl/cy9jdXJpb3NpdHku/anBn.png',
      ),
    ).toBe('oKfUtW34Dvo2BGQehJFR4Nr0_rIjOtdtzJ3QFsUcXH8');
  });

  const adapter = imgproxyTransform({
    baseUrl: 'https://img.example.com/',
    key: KEY,
    salt: SALT,
  });
  const source = {
    assetId: 'ast_1',
    url: 'https://cdn.example.com/pub/ast_1/hero.jpg',
    objectKey: 'pub/ast_1/hero.jpg',
    width: 4000,
    height: 3000,
    focalPoint: { x: 0.25, y: 0.75 },
  };

  it('builds a signed resize with the format in the path', async () => {
    const url = await adapter.url(source, { w: 960, format: 'avif', q: 75 });
    const encoded = Buffer.from(source.url).toString('base64url');
    const path = `/rs:fit:960:0:0/q:75/${encoded}.avif`;
    expect(url).toBe(
      `https://img.example.com/${await imgproxySignature(KEY, SALT, path)}${path}`,
    );
  });

  it('crops around the focal point for a cover fit', async () => {
    const url = await adapter.url(source, {
      w: 640,
      h: 640,
      fit: 'cover',
      format: 'webp',
      q: 75,
    });
    expect(url).toContain('/rs:fill:640:640:0/g:fp:0.25:0.75/q:75/');
  });

  it('refuses widths, formats and qualities outside the allowlists', async () => {
    for (const spec of [
      { w: 1000, format: 'webp' as const, q: 75 },
      { w: 640, format: 'webp' as const, q: 90 },
    ]) {
      await expect(adapter.url(source, spec)).rejects.toBeInstanceOf(
        TransformNotAllowedError,
      );
    }
    const webpOnly = imgproxyTransform({
      baseUrl: 'https://img.example.com',
      key: KEY,
      salt: SALT,
      formats: ['webp'],
    });
    await expect(
      webpOnly.url(source, { w: 640, format: 'avif', q: 75 }),
    ).rejects.toBeInstanceOf(TransformNotAllowedError);
    expect(() =>
      imgproxyTransform({ baseUrl: 'x', key: 'not-hex', salt: SALT }),
    ).toThrow();
  });
});

describe('asset endpoint with a transform adapter', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  async function setup() {
    const ctx = await setupTestCMS({
      withS3: true,
      media: {
        transform: imgproxyTransform({
          baseUrl: 'https://img.example.com',
          key: KEY,
          salt: SALT,
          formats: ['webp', 'avif'],
        }),
      },
    });
    cleanup = ctx.s3.cleanup;
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const { assets } = await ctx.cms.api.media.uploadAssets({
      body: {
        files: [
          {
            name: 'hero.png',
            size: png.length,
            type: 'image/png',
            buffer: new Blob([png as BlobPart]),
          },
        ],
      },
    });
    const id = assets[0].id;
    const get = (query: string) =>
      ctx.cms.router.handler(
        new Request(`http://localhost/api/cms/media/asset/${id}?${query}`),
      );
    return { ...ctx, id, get };
  }

  it('redirects a missing rendition of a public image to a signed url', async () => {
    const { cms, id, get } = await setup();
    await cms.api.media.updateAssetsStatus({
      body: { assetIds: [id], status: 'public' },
    });
    // 900 snaps to 960, a width only the adapter has.
    const res = await get('w=900&format=avif');
    expect(res.status).toBe(302);
    expect(res.headers.get('x-cms-rendition')).toBe('transform');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    const location = new URL(res.headers.get('location')!);
    expect(location.origin).toBe('https://img.example.com');
    const [, signature, ...rest] = location.pathname.split('/');
    const path = `/${rest.join('/')}`;
    expect(path).toMatch(/^\/rs:fit:960:0:0\/q:75\/[\w-]+\.avif$/);
    expect(signature).toBe(await imgproxySignature(KEY, SALT, path));
  });

  it('keeps private assets and other formats away from the transformer', async () => {
    const { cms, id, get } = await setup();
    const hidden = await get('w=900&format=webp');
    expect(hidden.headers.get('x-cms-rendition')).not.toBe('transform');

    await cms.api.media.updateAssetsStatus({
      body: { assetIds: [id], status: 'public' },
    });
    const png = await get('w=900&format=png');
    expect(png.headers.get('x-cms-rendition')).toBe('miss');
    expect(png.headers.get('location')).not.toContain('img.example.com');
    const tooWide = await get('w=4000');
    expect(tooWide.status).toBe(400);
  });
});

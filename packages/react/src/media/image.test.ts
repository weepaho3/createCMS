import { describe, expect, it } from 'vitest';

import type { ImageAsset } from './image';

import {
  buildSrcSet,
  createImageLoader,
  getAssetImage,
  objectPositionOf,
  variantUrl,
} from './image';
import nextLoader from './next-loader';

const variant = (variantKey: string, width: number) => ({
  variantKey,
  width,
  height: Math.round(width / 2),
  size: width * 10,
});

const asset: ImageAsset = {
  id: 'ast_1',
  deliveryUrl: '/api/cms/media/asset/ast_1',
  mimeType: 'image/jpeg',
  width: 4000,
  height: 2000,
  provenance: 'ai_generated',
  metadata: {
    focal: { x: 0.25, y: 0.8 },
    placeholder: { thumbhash: 'abc' },
    dominantColor: '#123456',
  },
  variants: [
    variant('w320.webp', 320),
    variant('w1280.webp', 1280),
    variant('w640.avif', 640),
    variant('poster-w640.webp', 640),
    variant('w800-h600.webp', 800),
  ],
};

describe('image helpers', () => {
  it('builds a srcset from existing renditions only', () => {
    expect(buildSrcSet(asset, 'webp')).toBe(
      '/api/cms/media/asset/ast_1?w=320&format=webp 320w, /api/cms/media/asset/ast_1?w=1280&format=webp 1280w',
    );
    expect(buildSrcSet(asset, 'avif')).toBe(
      '/api/cms/media/asset/ast_1?w=640&format=avif 640w',
    );
  });

  it('never guesses a width', () => {
    expect(variantUrl(asset, { w: 600 })).toBe(
      '/api/cms/media/asset/ast_1?w=1280&format=webp',
    );
    expect(variantUrl(asset, { w: 5000 })).toBe(
      '/api/cms/media/asset/ast_1?w=1280&format=webp',
    );
    expect(variantUrl(asset, { w: 100, format: 'jpeg' })).toBeNull();
  });

  it('turns the focal point into object-position', () => {
    expect(objectPositionOf({ x: 0.25, y: 0.8 })).toBe('25% 80%');
    expect(objectPositionOf(undefined)).toBe('50% 50%');
  });

  it('describes the image', () => {
    const image = getAssetImage(asset, {
      sizes: '100vw',
      widths: [320, 640, 1280, 1920],
      formats: ['webp'],
      focal: { x: 0, y: 0 },
      placeholderDataUrl: (hash) => `data:${hash}`,
      provenanceLabels: { ai_generated: 'AI-generated' },
    });
    expect(image).toMatchObject({
      src: '/api/cms/media/asset/ast_1?w=1280&format=webp',
      sizes: '100vw',
      width: 4000,
      height: 2000,
      objectPosition: '0% 0%',
      placeholder: { color: '#123456', dataUrl: 'data:abc' },
      provenance: 'ai_generated',
      provenanceLabel: 'AI-generated',
      missing: ['w640.webp', 'w1920.webp'],
    });
    expect(image.sources).toEqual([
      { type: 'image/webp', srcSet: buildSrcSet(asset, 'webp') },
    ]);
  });

  it('falls back to the original without renditions', () => {
    const image = getAssetImage(
      { id: 'a', deliveryUrl: '/a', mimeType: 'image/png' },
      { sizes: '50vw' },
    );
    expect(image).toMatchObject({
      src: '/a',
      srcSet: '',
      sources: [],
      provenance: 'unknown',
      provenanceLabel: null,
    });
  });
});

describe('image loader', () => {
  it('snaps every width to the ladder', () => {
    const loader = createImageLoader({ widths: [320, 640, 1280] });
    expect(loader({ src: '/a', width: 100 })).toBe('/a?w=320&format=webp');
    expect(loader({ src: '/a', width: 641 })).toBe('/a?w=1280&format=webp');
    expect(loader({ src: '/a?x=1', width: 3840 })).toBe(
      '/a?x=1&w=1280&format=webp',
    );
    expect(nextLoader({ src: '/a', width: 1500 })).toBe(
      '/a?w=1920&format=webp',
    );
  });
});

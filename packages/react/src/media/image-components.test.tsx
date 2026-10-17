import { cleanup, fireEvent, render } from '@testing-library/react';
// @vitest-environment happy-dom
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { ImageAsset } from './image';

import { MediaImage, MediaPicture } from './image-components';

afterEach(cleanup);

const asset: ImageAsset = {
  id: 'ast_1',
  deliveryUrl: '/m/ast_1',
  mimeType: 'image/jpeg',
  width: 2000,
  height: 1000,
  provenance: 'ai_generated',
  metadata: { dominantColor: '#123456', focal: { x: 0.1, y: 0.9 } },
  variants: [
    { variantKey: 'w640.webp', width: 640, height: 320, size: 1 },
    { variantKey: 'w640.avif', width: 640, height: 320, size: 1 },
  ],
};

describe('Media.Image', () => {
  it('renders existing renditions, focal point and data attributes', () => {
    const { getByRole } = render(
      <MediaImage asset={asset} sizes="50vw" alt="Team" widths={[640, 1280]} />,
    );
    const img = getByRole('img');
    expect(img.getAttribute('srcset')).toBe('/m/ast_1?w=640&format=webp 640w');
    expect(img.getAttribute('sizes')).toBe('50vw');
    expect(img.getAttribute('src')).toBe('/m/ast_1?w=640&format=webp');
    expect(img.getAttribute('width')).toBe('2000');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.dataset.provenance).toBe('ai_generated');
    expect(img.dataset.variantMissing).toBe('w1280.webp');
    expect(img.style.objectPosition).toBe('10% 90%');
    expect(img.hasAttribute('data-placeholder')).toBe(true);

    fireEvent.load(img);
    expect(img.hasAttribute('data-loaded')).toBe(true);
    expect(img.hasAttribute('data-placeholder')).toBe(false);
  });
});

describe('Media.Picture', () => {
  it('offers AVIF before WebP', () => {
    const { container } = render(
      <MediaPicture asset={asset} sizes="100vw" alt="" />,
    );
    const types = [...container.querySelectorAll('source')].map((s) =>
      s.getAttribute('type'),
    );
    expect(types).toEqual(['image/avif', 'image/webp']);
    expect(container.querySelector('picture')?.dataset.provenance).toBe(
      'ai_generated',
    );
  });
});

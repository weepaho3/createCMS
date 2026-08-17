import { describe, expect, it } from 'vitest';

import { assetUrl, labelFromRoot } from './field-sources';

describe('assetUrl', () => {
  it('builds the default gate path', () => {
    expect(assetUrl('ast_1')).toBe('/api/cms/media/asset/ast_1');
  });

  it('adds format and width query params', () => {
    expect(
      assetUrl('ast_1', { basePath: '/api/cms/', format: 'webp', w: 800 }),
    ).toBe('/api/cms/media/asset/ast_1?format=webp&w=800');
  });

  it('adds width only when format is omitted', () => {
    expect(assetUrl('ast_1', { w: 400 })).toBe(
      '/api/cms/media/asset/ast_1?w=400',
    );
  });

  it('throws when id is empty', () => {
    expect(() => assetUrl('')).toThrow(
      'cms field sources: assetUrl requires an id',
    );
  });
});

describe('labelFromRoot', () => {
  it('prefers title, then label, then name, then slug, then path, then id', () => {
    expect(
      labelFromRoot({
        id: 'root_1',
        properties: { title: 'Home', label: 'L', name: 'N' },
        slug: 'home',
        path: '/home',
      }),
    ).toBe('Home');

    expect(
      labelFromRoot({
        id: 'root_1',
        properties: { label: 'Label', name: 'N' },
        slug: 'home',
        path: '/home',
      }),
    ).toBe('Label');

    expect(
      labelFromRoot({
        id: 'root_1',
        properties: { name: 'Name' },
        slug: 'home',
        path: '/home',
      }),
    ).toBe('Name');

    expect(
      labelFromRoot({
        id: 'root_1',
        properties: {},
        slug: 'home',
        path: '/home',
      }),
    ).toBe('home');

    expect(
      labelFromRoot({
        id: 'root_1',
        properties: {},
        path: '/home',
      }),
    ).toBe('/home');

    expect(
      labelFromRoot({
        id: 'root_1',
        properties: {},
      }),
    ).toBe('root_1');
  });
});

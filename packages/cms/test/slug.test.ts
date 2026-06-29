import { describe, expect, it } from 'vitest';

import { buildVariantSlug, createSlug } from '../src/core/storage/s3/utils';

describe('createSlug', () => {
  it('lowercases and trims', () => {
    expect(createSlug('  Hello World.jpg  ')).toBe('hello-world.jpg');
  });

  it('strips diacritics', () => {
    expect(createSlug('café-résumé.pdf')).toBe('cafe-resume.pdf');
  });

  it('replaces spaces with hyphens', () => {
    expect(createSlug('my cool photo.png')).toBe('my-cool-photo.png');
  });

  it('collapses multiple spaces into single hyphen', () => {
    expect(createSlug('too   many    spaces.jpg')).toBe('too-many-spaces.jpg');
  });

  it('transliterates special characters', () => {
    expect(createSlug('file@#$%^&()!.png')).toBe('filedollarpercentand.png');
  });

  it('converts dots in filename to hyphens', () => {
    expect(createSlug('my.file.name.tar.gz')).toBe('my-file-name-tar.gz');
  });

  it('handles filenames with no extension', () => {
    expect(createSlug('README')).toBe('readme');
  });

  it('handles already-clean slugs', () => {
    expect(createSlug('clean-slug.jpg')).toBe('clean-slug.jpg');
  });

  it('handles numeric filenames', () => {
    expect(createSlug('12345.png')).toBe('12345.png');
  });

  it('handles unicode characters with diacritics', () => {
    expect(createSlug('über-Ärger.jpg')).toBe('uber-arger.jpg');
  });

  it('transliterates ß to ss', () => {
    expect(createSlug('straße.jpg')).toBe('strasse.jpg');
  });

  it('handles dot-only input gracefully', () => {
    expect(createSlug('...')).toBe('.');
  });
});

describe('buildVariantSlug', () => {
  it('adds format suffix', () => {
    expect(buildVariantSlug('hero.jpg', 'webp')).toBe('hero-webp.webp');
  });

  it('adds width suffix', () => {
    expect(buildVariantSlug('hero.jpg', undefined, 800)).toBe('hero-800.jpg');
  });

  it('adds both width and format', () => {
    expect(buildVariantSlug('hero.jpg', 'webp', 800)).toBe(
      'hero-800-webp.webp',
    );
  });

  it('returns original slug when no options', () => {
    expect(buildVariantSlug('hero.jpg')).toBe('hero.jpg');
  });

  it('handles slugs without extension', () => {
    expect(buildVariantSlug('readme', 'webp', 800)).toBe(
      'readme-800-webp.webp',
    );
  });

  it('handles slugs with multiple dots', () => {
    expect(buildVariantSlug('my.photo.jpg', 'webp')).toBe('my.photo-webp.webp');
  });
});

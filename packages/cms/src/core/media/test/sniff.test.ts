import { describe, expect, it } from 'vitest';

import { checkDeclaredType, isMarkup, isSvgType, sniffType } from '../sniff';
import { validateFiles } from '../uploads';

const text = (value: string) => new TextEncoder().encode(value);
const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === 'string' ? [...text(part)] : part,
    ),
  );

/** An ISO BMFF `ftyp` box with a major brand and compatible brands. */
function ftyp(major: string, ...compatible: string[]) {
  const size = 16 + compatible.length * 4;
  return bytes(
    [0, 0, 0, size],
    'ftyp',
    major,
    [0, 0, 0, 0],
    compatible.join(''),
    [0, 0, 0, 8],
    'mdat',
  );
}

const FIXTURES: [string, Uint8Array, string | undefined][] = [
  [
    'png',
    bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
    'image/png',
  ],
  ['jpeg', bytes([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'],
  ['gif', bytes('GIF89a'), 'image/gif'],
  ['webp', bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '), 'image/webp'],
  ['wav', bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt '), 'audio/wav'],
  ['avif', ftyp('avif', 'mif1', 'miaf'), 'image/avif'],
  ['avif by compatible brand', ftyp('mif1', 'avif'), 'image/avif'],
  ['heic', ftyp('heic', 'mif1', 'heic'), 'image/heic'],
  ['heif', ftyp('mif1', 'mif1'), 'image/heif'],
  ['mp4', ftyp('isom', 'iso2', 'avc1', 'mp41'), 'video/mp4'],
  ['mov', ftyp('qt  ', 'qt  '), 'video/quicktime'],
  [
    'webm',
    bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84], 'webm'),
    'video/webm',
  ],
  [
    'mkv',
    bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88], 'matroska'),
    'video/x-matroska',
  ],
  ['pdf', bytes('%PDF-1.7\n'), 'application/pdf'],
  ['zip', bytes([0x50, 0x4b, 0x03, 0x04]), 'application/zip'],
  ['mp3', bytes('ID3', [4, 0, 0]), 'audio/mpeg'],
  ['ogg', bytes('OggS'), 'audio/ogg'],
  ['html', bytes('<!DOCTYPE html><html><body>'), 'text/html'],
  [
    'svg',
    bytes('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg">'),
    'image/svg+xml',
  ],
  ['plain text', bytes('hello world'), undefined],
];

describe('sniffType', () => {
  it.each(FIXTURES)('recognizes %s', (_name, input, expected) => {
    expect(sniffType(input)).toBe(expected);
  });

  it('treats a document hiding %PDF- in a comment as markup', () => {
    expect(
      sniffType(bytes('<html><!-- %PDF-1.4 --><script>x()</script>')),
    ).toBe('text/html');
  });

  it('finds markup after a BOM, whitespace, comments and doctypes', () => {
    expect(
      isMarkup(bytes([0xef, 0xbb, 0xbf], '  <!-- x -->\n<svg onload="x()">')),
    ).toBe(true);
    expect(isMarkup(bytes('<foo:bar xmlns:foo="urn:x">'))).toBe(true);
    expect(isMarkup(bytes('Notes about <svg> tags'))).toBe(false);
  });
});

describe('checkDeclaredType', () => {
  it('accepts matching signatures and their equivalent types', () => {
    expect(checkDeclaredType('image/png', FIXTURES[0][1]).ok).toBe(true);
    expect(checkDeclaredType('image/jpg', FIXTURES[1][1]).ok).toBe(true);
    expect(checkDeclaredType('image/heif', ftyp('heic', 'mif1')).ok).toBe(true);
    expect(
      checkDeclaredType('video/webm', bytes([0x1a, 0x45, 0xdf, 0xa3], 'webm'))
        .ok,
    ).toBe(true);
    expect(
      checkDeclaredType(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes([0x50, 0x4b, 0x03, 0x04]),
      ).ok,
    ).toBe(true);
  });

  it('rejects HTML declared as PDF and markup under any non-text type', () => {
    expect(
      checkDeclaredType(
        'application/pdf',
        bytes('<html><script>alert(1)</script>'),
      ),
    ).toEqual({
      ok: false,
      sniffed: 'text/html',
      reason: 'markup',
    });
    expect(checkDeclaredType('image/png', bytes('<svg onload="x()">')).ok).toBe(
      false,
    );
    expect(
      checkDeclaredType('application/octet-stream', bytes('<html>')).ok,
    ).toBe(false);
    expect(checkDeclaredType('text/plain', bytes('<html>')).ok).toBe(true);
  });

  it('rejects contradicting signatures and unknown bytes for renderable types', () => {
    expect(checkDeclaredType('image/png', FIXTURES[1][1])).toMatchObject({
      ok: false,
      reason: 'mismatch',
    });
    expect(checkDeclaredType('video/mp4', bytes('%PDF-1.4'))).toMatchObject({
      ok: false,
      reason: 'mismatch',
    });
    expect(
      checkDeclaredType('image/avif', bytes('garbage bytes')),
    ).toMatchObject({ ok: false, reason: 'unknown' });
    expect(
      checkDeclaredType('application/pdf', bytes('not a pdf')),
    ).toMatchObject({ ok: false, reason: 'unknown' });
    expect(checkDeclaredType('text/csv', bytes('a,b\n1,2')).ok).toBe(true);
  });
});

describe('SVG', () => {
  it('is refused even when the allowlist names it or a wildcard covers it', () => {
    expect(isSvgType('image/svg+xml')).toBe(true);
    expect(isSvgType('image/svg+xml; charset=utf-8')).toBe(true);
    const config = {
      maxFiles: 10,
      maxFileSize: 1e6,
      allowedMimeTypes: ['image/*', 'image/svg+xml'],
    };
    expect(() =>
      validateFiles(
        [{ name: 'logo.svg', size: 10, type: 'image/svg+xml' }],
        config,
      ),
    ).toThrow(expect.objectContaining({ cmsCode: 'INVALID_FILE_TYPE' }));
    expect(() =>
      validateFiles(
        [{ name: 'logo.svg', size: 10, type: 'image/png' }],
        config,
      ),
    ).toThrow(expect.objectContaining({ cmsCode: 'INVALID_FILE_TYPE' }));
    expect(() =>
      validateFiles(
        [{ name: 'logo.png', size: 10, type: 'image/png' }],
        config,
      ),
    ).not.toThrow();
  });
});

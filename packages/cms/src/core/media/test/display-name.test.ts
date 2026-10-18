import { describe, expect, it } from 'vitest';

import { DISPLAY_NAME_MAX_BYTES, normalizeDisplayName } from '../display-name';

describe('normalizeDisplayName', () => {
  it('drops bidi overrides and control characters', () => {
    expect(
      normalizeDisplayName(
        'invoice' + String.fromCodePoint(0x202e) + 'fdp.exe',
      ),
    ).toBe('invoicefdp.exe');
    expect(
      normalizeDisplayName(
        'a' +
          String.fromCodePoint(0x2066) +
          'b' +
          String.fromCodePoint(0x2069) +
          'c\u0000d\u0085e.txt',
      ),
    ).toBe('abcde.txt');
  });

  it('composes to NFC, collapses whitespace and replaces separators', () => {
    expect(normalizeDisplayName('Grüße  \t aus/Berlin.jpg')).toBe(
      'Grüße aus_Berlin.jpg',
    );
  });

  it('makes the extension match the type', () => {
    expect(normalizeDisplayName('report', 'application/pdf')).toBe(
      'report.pdf',
    );
    expect(normalizeDisplayName('photo.JPEG', 'image/jpeg')).toBe('photo.JPEG');
    expect(normalizeDisplayName('photo.png', 'image/webp')).toBe(
      'photo.png.webp',
    );
    expect(normalizeDisplayName('...', 'image/png')).toBe('download.png');
  });

  it('caps the name at 200 UTF-8 bytes and keeps the extension', () => {
    const name = normalizeDisplayName(`${'ü'.repeat(150)}.jpg`, 'image/jpeg');
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(
      DISPLAY_NAME_MAX_BYTES,
    );
    expect(name.endsWith('.jpg')).toBe(true);
    expect(name.startsWith('ü')).toBe(true);
  });
});

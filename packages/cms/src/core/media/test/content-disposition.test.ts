import { describe, expect, it } from 'vitest';

import { contentDisposition, safeDownloadName } from '../content-disposition';

describe('contentDisposition', () => {
  it('keeps the full name in filename* and a readable ASCII fallback', () => {
    expect(
      contentDisposition('Übersicht März (final).PDF', 'application/pdf'),
    ).toBe(
      `attachment; filename="Ubersicht Marz (final).PDF"; filename*=UTF-8''%C3%9Cbersicht%20M%C3%A4rz%20%28final%29.PDF`,
    );
  });

  it("percent-encodes ' ( ) * in filename*", () => {
    expect(contentDisposition("it's (a)*.png", 'image/png')).toContain(
      "filename*=UTF-8''it%27s%20%28a%29%2A.png",
    );
  });

  it('replaces quotes, backslashes and % in the fallback', () => {
    expect(contentDisposition('a"b%c.png', 'image/png')).toContain(
      'filename="a_b_c.png"',
    );
  });

  it('drops characters without an ASCII form from the fallback', () => {
    expect(contentDisposition('🎉.png', 'image/png')).toBe(
      `attachment; filename=".png"; filename*=UTF-8''%F0%9F%8E%89.png`,
    );
    expect(contentDisposition('写真', 'application/octet-stream')).toContain(
      'filename="download"',
    );
  });

  it('supports inline', () => {
    expect(contentDisposition('a.png', 'image/png', 'inline')).toMatch(
      /^inline; /,
    );
  });
});

describe('safeDownloadName', () => {
  it('removes CR/LF and path separators', () => {
    expect(safeDownloadName('a\r\nb.png', 'image/png')).toBe('ab.png');
    expect(safeDownloadName('../../etc/passwd', 'text/plain')).toBe(
      '.._.._etc_passwd',
    );
  });

  it('enforces an extension that matches the MIME type', () => {
    expect(safeDownloadName('report', 'application/pdf')).toBe('report.pdf');
    expect(safeDownloadName('photo.png', 'image/jpeg')).toBe('photo.png.jpg');
    expect(safeDownloadName('photo.JPEG', 'image/jpeg')).toBe('photo.JPEG');
    expect(safeDownloadName('notes.txt', 'text/plain')).toBe('notes.txt');
  });

  it('falls back to "download" for an empty name', () => {
    expect(safeDownloadName('', 'image/png')).toBe('download.png');
    expect(safeDownloadName('..', 'text/plain')).toBe('download');
  });
});

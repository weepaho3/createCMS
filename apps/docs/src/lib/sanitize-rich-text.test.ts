import { describe, expect, it } from 'vitest';

import { sanitizeRichTextHtml } from './sanitize-rich-text';

describe('sanitizeRichTextHtml', () => {
  it.each([
    ['<img src=x onerror=alert(1)>', '<img src="x">'],
    ['<a href="javascript:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="JaVaScRiPt:alert(1)">x</a>', '<a>x</a>'],
    ['<a href="data:text/html,<script>alert(1)</script>">x</a>', '<a>x</a>'],
    ['<script>alert(1)</script><p>ok</p>', '<p>ok</p>'],
    ['<p onclick="alert(1)">ok</p>', '<p>ok</p>'],
    ['<svg><script>alert(1)</script></svg>', '<svg></svg>'],
  ])('neutralizes %s', (input, expected) => {
    expect(sanitizeRichTextHtml(input)).toBe(expected);
  });

  it.each([
    'https://example.com/a',
    'http://example.com',
    'mailto:hi@example.com',
    'tel:+491234',
    '/pages/about',
    '#section',
  ])('keeps the link %s', (href) => {
    expect(sanitizeRichTextHtml(`<a href="${href}">x</a>`)).toBe(
      `<a href="${href}">x</a>`,
    );
  });

  it('adds rel="noopener noreferrer" to links with a target', () => {
    expect(
      sanitizeRichTextHtml(
        '<a href="https://example.com" target="_blank">x</a>',
      ),
    ).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });

  it('keeps formatting markup', () => {
    const html =
      '<p>Hello <strong>bold</strong> <em>it</em></p><ul><li>a</li></ul>';
    expect(sanitizeRichTextHtml(html)).toBe(html);
  });

  it('returns an empty string for non-string values', () => {
    expect(sanitizeRichTextHtml(undefined)).toBe('');
    expect(sanitizeRichTextHtml(42)).toBe('');
  });
});

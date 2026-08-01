import { describe, expect, it } from 'vitest';

import type { TextDiffSegment } from '../types';

import { diffRichText } from '../text-diff';

/** Rebuilds `from` out of the non-`ins` segments. */
function concatFrom(segments: TextDiffSegment[]): string {
  return segments
    .filter((s) => s.type !== 'ins')
    .map((s) => s.html)
    .join('');
}

/** Rebuilds `to` out of the non-`del` segments. */
function concatTo(segments: TextDiffSegment[]): string {
  return segments
    .filter((s) => s.type !== 'del')
    .map((s) => s.html)
    .join('');
}

describe('diffRichText', () => {
  it('returns a single same segment for identical input', () => {
    const html = '<p>Hello <strong>world</strong></p>';
    expect(diffRichText(html, html)).toEqual([{ type: 'same', html }]);
  });

  it('returns [] when both strings are empty', () => {
    expect(diffRichText('', '')).toEqual([]);
  });

  it('emits a pure insertion from empty to content', () => {
    expect(diffRichText('', '<p>New</p>')).toEqual([
      { type: 'ins', html: '<p>New</p>' },
    ]);
  });

  it('emits a pure deletion from content to empty', () => {
    expect(diffRichText('<p>Old</p>', '')).toEqual([
      { type: 'del', html: '<p>Old</p>' },
    ]);
  });

  it('diffs a single word change mid-sentence', () => {
    expect(diffRichText('The quick brown fox', 'The quick red fox')).toEqual([
      { type: 'same', html: 'The quick ' },
      { type: 'del', html: 'brown ' },
      { type: 'ins', html: 'red ' },
      { type: 'same', html: 'fox' },
    ]);
  });

  it('diffs an insertion at the end', () => {
    // The last word of `from` carries no trailing whitespace, so appending
    // text rewrites that final token: del of the old tail, ins of the new.
    expect(diffRichText('Hello world', 'Hello world again')).toEqual([
      { type: 'same', html: 'Hello ' },
      { type: 'del', html: 'world' },
      { type: 'ins', html: 'world again' },
    ]);
  });

  it('diffs a tag-delimited insertion at the end without touching the old tail', () => {
    expect(diffRichText('<p>Hi</p>', '<p>Hi</p><p>Bye</p>')).toEqual([
      { type: 'same', html: '<p>Hi</p>' },
      { type: 'ins', html: '<p>Bye</p>' },
    ]);
  });

  it('diffs a deletion at the start', () => {
    expect(diffRichText('Alpha beta gamma', 'beta gamma')).toEqual([
      { type: 'del', html: 'Alpha ' },
      { type: 'same', html: 'beta gamma' },
    ]);
  });

  it('keeps surrounding tags same when a word changes inside them', () => {
    const segments = diffRichText(
      '<p>Hello <em>big</em> world</p>',
      '<p>Hello <em>small</em> world</p>',
    );
    expect(segments).toEqual([
      { type: 'same', html: '<p>Hello <em>' },
      { type: 'del', html: 'big' },
      { type: 'ins', html: 'small' },
      { type: 'same', html: '</em> world</p>' },
    ]);
  });

  it('treats a tag with changed attributes as del + ins, not same', () => {
    expect(diffRichText('<p class="a">x</p>', '<p class="b">x</p>')).toEqual([
      { type: 'del', html: '<p class="a">' },
      { type: 'ins', html: '<p class="b">' },
      { type: 'same', html: 'x</p>' },
    ]);
  });

  it('collapses a full replacement into one del + one ins', () => {
    expect(diffRichText('old text here', 'brand new stuff')).toEqual([
      { type: 'del', html: 'old text here' },
      { type: 'ins', html: 'brand new stuff' },
    ]);
  });

  it('diffs plain text without any tags', () => {
    expect(diffRichText('one two three four', 'one 2 three four')).toEqual([
      { type: 'same', html: 'one ' },
      { type: 'del', html: 'two ' },
      { type: 'ins', html: '2 ' },
      { type: 'same', html: 'three four' },
    ]);
  });

  it('bails out to a coarse del/ins pair on oversized inputs', () => {
    const words = (letter: string, count: number) =>
      Array.from({ length: count }, (_, i) => `${letter}${i}`).join(' ');
    const from = `same ${words('a', 4000)}`;
    const to = `same ${words('b', 4000)}`;

    const segments = diffRichText(from, to);
    expect(segments).toEqual([
      { type: 'same', html: 'same ' },
      { type: 'del', html: words('a', 4000) },
      { type: 'ins', html: words('b', 4000) },
    ]);
    expect(concatFrom(segments)).toBe(from);
    expect(concatTo(segments)).toBe(to);
  });

  describe('invariants', () => {
    const cases: [string, string][] = [
      ['', ''],
      ['', '<p>New</p>'],
      ['<p>Old</p>', ''],
      ['<p>Hello world</p>', '<p>Hello world</p>'],
      ['The quick brown fox', 'The quick red fox'],
      ['Hello world', 'Hello world again'],
      ['<p>Hi</p>', '<p>Hi</p><p>Bye</p>'],
      ['Alpha beta gamma', 'beta gamma'],
      ['<p>Hello <em>big</em> world</p>', '<p>Hello <em>small</em> world</p>'],
      ['<p class="a">x</p>', '<p class="b">x</p>'],
      ['old text here', 'brand new stuff'],
      ['one two three four', 'one 2 three four'],
      ['  leading and   inner\nwhitespace ', 'leading and inner whitespace'],
      [
        '<ul><li>a</li><li>b</li></ul>',
        '<ul><li>a</li><li>c</li><li>b</li></ul>',
      ],
      ['text with <br/> void tag', 'text without void tag'],
    ];

    it.each(cases)(
      'same+del === from and same+ins === to (%j -> %j)',
      (from, to) => {
        const segments = diffRichText(from, to);
        expect(concatFrom(segments)).toBe(from);
        expect(concatTo(segments)).toBe(to);
      },
    );

    it.each(cases)(
      'never emits adjacent segments of the same type (%j -> %j)',
      (from, to) => {
        const segments = diffRichText(from, to);
        for (let i = 1; i < segments.length; i++) {
          expect(segments[i].type).not.toBe(segments[i - 1].type);
        }
        for (const segment of segments) {
          expect(segment.html).not.toBe('');
        }
      },
    );
  });
});

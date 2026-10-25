import { describe, expect, it } from 'vitest';

import type { RichTextDoc, RichTextNode } from '../../rich-text/types';
import type { RichTextDiffSegment } from '../types';

import { richTextToPlainText } from '../../rich-text/convert';
import { diffRichText } from '../text-diff';

const text = (value: string, marks?: RichTextNode['marks']): RichTextNode =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const p = (...content: RichTextNode[]): RichTextNode => ({
  type: 'paragraph',
  content,
});
const doc = (...content: RichTextNode[]): RichTextDoc => ({
  type: 'doc',
  content,
});
const plain = (value: string) =>
  doc(...value.split('\n').map((line) => p(text(line))));

const short = (segments: RichTextDiffSegment[]) =>
  segments.map((s) => `${s.type}:${s.text}`);

const sideText = (
  segments: RichTextDiffSegment[],
  side: 'from' | 'to',
): string[] => {
  const blocks = new Map<number, string>();
  for (const s of segments) {
    if (s.type === (side === 'from' ? 'ins' : 'del')) continue;
    blocks.set(s.block, (blocks.get(s.block) ?? '') + s.text);
  }
  return [...blocks.values()];
};

describe('diffRichText', () => {
  it('returns nothing for two empty values and one same run for equal ones', () => {
    expect(diffRichText(doc(), doc())).toEqual([]);
    expect(
      short(diffRichText(plain('Hello world'), plain('Hello world'))),
    ).toEqual(['same:Hello world']);
  });

  it('diffs a word change mid-sentence', () => {
    expect(
      short(
        diffRichText(plain('The quick brown fox'), plain('The quick red fox')),
      ),
    ).toEqual(['same:The quick ', 'del:brown ', 'ins:red ', 'same:fox']);
  });

  it('diffs insertions and deletions at the ends', () => {
    expect(
      short(diffRichText(plain('Hello world'), plain('Hello world again'))),
    ).toEqual(['same:Hello ', 'del:world', 'ins:world again']);
    expect(
      short(diffRichText(plain('Alpha beta gamma'), plain('beta gamma'))),
    ).toEqual(['del:Alpha ', 'same:beta gamma']);
    expect(short(diffRichText(doc(), plain('New')))).toEqual(['ins:New']);
    expect(short(diffRichText(plain('Old'), doc()))).toEqual(['del:Old']);
  });

  it('reports a formatting-only change as format with the old marks', () => {
    const segments = diffRichText(
      doc(p(text('Hello '), text('big'), text(' world'))),
      doc(p(text('Hello '), text('big', [{ type: 'bold' }]), text(' world'))),
    );
    expect(segments).toEqual([
      expect.objectContaining({ type: 'same', text: 'Hello ', marks: [] }),
      expect.objectContaining({
        type: 'format',
        text: 'big',
        marks: [{ type: 'bold' }],
        fromMarks: [],
      }),
      expect.objectContaining({ type: 'same', text: ' world' }),
    ]);
  });

  it('carries blocks: index, type and heading level', () => {
    const segments = diffRichText(
      doc(p(text('Hi'))),
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
        p(text('Hi')),
      ),
    );
    expect(segments).toEqual([
      expect.objectContaining({
        type: 'ins',
        text: 'Title',
        block: 0,
        blockType: 'heading',
        level: 2,
      }),
      expect.objectContaining({
        type: 'same',
        text: 'Hi',
        block: 1,
        blockType: 'paragraph',
      }),
    ]);
  });

  it('reads list items and quotes as text blocks', () => {
    const list = (...items: string[]): RichTextDoc =>
      doc({
        type: 'bulletList',
        content: items.map((item) => ({
          type: 'listItem',
          content: [p(text(item))],
        })),
      });
    expect(short(diffRichText(list('a', 'b'), list('a', 'c', 'b')))).toEqual([
      'same:a',
      'ins:c',
      'same:b',
    ]);
  });

  it.each([
    ['one two three four', 'one 2 three four'],
    ['old text here', 'brand new stuff'],
    ['Hello', 'Hello\nBye'],
    ['  leading and   inner', 'leading and inner'],
  ])('same+del rebuild the old text and same+ins the new (%j)', (a, b) => {
    const from = plain(a);
    const to = plain(b);
    const segments = diffRichText(from, to);
    expect(sideText(segments, 'from').join('\n')).toBe(
      richTextToPlainText(from),
    );
    expect(sideText(segments, 'to').join('\n')).toBe(richTextToPlainText(to));
  });

  it('bails out to a coarse del/ins pair on oversized inputs', () => {
    const many = (word: string) =>
      plain(Array.from({ length: 3500 }, (_, i) => `${word}${i}`).join(' '));
    const segments = diffRichText(many('a'), many('b'));
    expect(segments.map((s) => s.type)).toEqual(['del', 'ins']);
  });
});

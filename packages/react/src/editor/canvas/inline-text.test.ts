import { describe, expect, it } from 'vitest';

import {
  applyTextEdit,
  isInlineEditableKind,
  stripPlaceholder,
  withEmptyFieldPlaceholder,
} from './inline-text';

const specs = {
  text: { type: 'richText' as const, label: 'Text' },
  level: { type: 'number' as const, label: 'Level' },
  image: { type: 'image' as const, label: 'Image' },
};

describe('applyTextEdit', () => {
  it('replaces a range with insert text', () => {
    expect(applyTextEdit('ab{{', 2, 4, '{{name}}')).toEqual({
      text: 'ab{{name}}',
      caret: 10,
    });
  });

  it('inserts at the end when start equals end', () => {
    expect(applyTextEdit('hello', 5, 5, '!')).toEqual({
      text: 'hello!',
      caret: 6,
    });
  });
});

describe('stripPlaceholder', () => {
  it('removes the zero-width placeholder', () => {
    expect(stripPlaceholder('\u200B')).toBe('');
    expect(stripPlaceholder('ab')).toBe('ab');
  });
});

describe('withEmptyFieldPlaceholder', () => {
  it('fills empty string fields and leaves other kinds', () => {
    expect(withEmptyFieldPlaceholder({ text: '', level: 2 }, specs)).toEqual({
      text: '\u200B',
      level: 2,
    });
  });

  it('fills a missing key and skips non-text kinds', () => {
    expect(withEmptyFieldPlaceholder({ level: 2 }, specs)).toEqual({
      text: '\u200B',
      level: 2,
    });
    expect(
      withEmptyFieldPlaceholder({ image: 'x.png' }, { image: specs.image }),
    ).toEqual({ image: 'x.png' });
  });
});

describe('isInlineEditableKind', () => {
  it('accepts string and richText only', () => {
    expect(isInlineEditableKind('richText')).toBe(true);
    expect(isInlineEditableKind('number')).toBe(false);
  });
});

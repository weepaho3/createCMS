import { describe, expect, it } from 'vitest';

import {
  applyTextEdit,
  isInlineEditableField,
  isInlineEditableKind,
  stripPlaceholder,
  withEmptyFieldPlaceholder,
} from './inline-text';

const specs = {
  text: { type: 'text' as const, label: 'Text' },
  body: { type: 'richText' as const, label: 'Body' },
  level: { type: 'number' as const, label: 'Level' },
  image: { type: 'media' as const, label: 'Image' },
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
    expect(
      withEmptyFieldPlaceholder({ text: '', body: '', level: 2 }, specs),
    ).toEqual({
      text: '\u200B',
      body: '',
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
  it.each([
    ['text', true],
    ['textarea', false],
    ['richText', false],
    ['number', false],
    ['media', false],
  ])('%s is inline editable: %s', (kind, expected) => {
    expect(isInlineEditableKind(kind)).toBe(expected);
  });
});

describe('isInlineEditableField', () => {
  it('excludes readOnly text fields', () => {
    expect(isInlineEditableField({ type: 'text' })).toBe(true);
    expect(isInlineEditableField({ type: 'text', readOnly: true })).toBe(false);
    expect(isInlineEditableField({ type: 'richText' })).toBe(false);
  });
});

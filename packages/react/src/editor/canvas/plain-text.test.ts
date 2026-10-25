import { describe, expect, it } from 'vitest';

import { normalizePlainText } from './plain-text';

describe('normalizePlainText', () => {
  it('turns NBSP into spaces, drops trailing newlines and joins lines', () => {
    expect(normalizePlainText('a b\r\nc\n\n', false)).toBe('a b c');
    expect(normalizePlainText('a\r\nb\rc\n', true)).toBe('a\nb\nc');
  });
});

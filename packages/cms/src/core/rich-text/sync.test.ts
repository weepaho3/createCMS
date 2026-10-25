import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The same model lives in `@createcms/react` (`editor/core/richtext`); the
// shared files must stay byte for byte identical.
const SHARED = ['types', 'schema', 'validate', 'convert', 'parse-html'];
const EDITOR = join(
  import.meta.dirname,
  '../../../../react/src/editor/core/richtext',
);

describe('rich text model', () => {
  it.each(SHARED)('%s.ts matches the editor copy', (name) => {
    const here = readFileSync(join(import.meta.dirname, `${name}.ts`), 'utf8');
    const there = readFileSync(join(EDITOR, `${name}.ts`), 'utf8');
    expect(here).toBe(there);
  });

  it('imports nothing outside the folder', () => {
    for (const name of SHARED) {
      const source = readFileSync(
        join(import.meta.dirname, `${name}.ts`),
        'utf8',
      );
      for (const match of source.matchAll(/from '([^']+)'/g)) {
        expect(match[1]).toMatch(/^\.\/[\w-]+$/);
      }
    }
  });
});

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Visible text and accessible names must come from the catalog
// (messages.ts); these patterns catch English literals in the parts.
const LITERAL_PATTERNS: RegExp[] = [
  /'aria-(label|valuetext|description)':\s*['`"]/,
  /aria-(label|valuetext|description)="[^"{]/,
  /children:\s*[^,\n]*\?\?\s*['`"]/,
  // JSX text between tags; `=> Promise<...>` (a return type) is not text.
  /(?<!=)>\s*[A-Za-z][A-Za-z ,.]+\s*</,
  /return\s+['`"][A-Z][a-z]+[ .:]/,
];

const PART_FILES = fs
  .readdirSync(HERE)
  .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'));

describe('media parts', () => {
  it.each(PART_FILES)('%s renders no literal text', (name) => {
    const source = fs.readFileSync(path.join(HERE, name), 'utf8');
    const offending = source
      .split('\n')
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*'))
      .filter(({ line }) => LITERAL_PATTERNS.some((p) => p.test(line)));
    expect(
      offending.map(({ line, number }) => `${name}:${number}: ${line}`),
    ).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { mentionsToken, readDoc } from '../../test-utils/docs';
import { EDITOR_CODES } from '../core/codes';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BARREL = path.join(HERE, 'index.ts');
const RENDER_MDX = 'reference/react-editor-render.mdx';
const CODES_MDX = 'reference/editor-errors.mdx';

describe('docs coverage: react editor render', () => {
  it('documents every export of the render entry', () => {
    const source = readFileSync(BARREL, 'utf8');
    const symbols = [
      ...source.matchAll(/^export (?:type|function|const) (\w+)/gm),
    ].map((match) => match[1] as string);
    const doc = readDoc(RENDER_MDX);
    expect(symbols.length).toBeGreaterThan(3);
    const undocumented = symbols.filter((s) => !mentionsToken(doc, s));
    expect(
      undocumented,
      `exports missing from ${RENDER_MDX}: ${undocumented.join(', ')}`,
    ).toEqual([]);
  });

  it('documents every editor code under its own heading', () => {
    const doc = readDoc(CODES_MDX);
    const missing = Object.keys(EDITOR_CODES).filter(
      (code) => !doc.includes(`## ${code}\n`),
    );
    expect(missing, `codes missing from ${CODES_MDX}`).toEqual([]);
  });
});

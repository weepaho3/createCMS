import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  diffSets,
  exportedSymbols,
  mentionsToken,
  parseSourceFile,
  readDoc,
} from '../test-utils/docs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BARREL = path.join(HERE, 'index.ts');
const EDITOR_MDX = 'reference/react-editor.mdx';

describe('docs coverage: react editor', () => {
  it('documents every export from the editor barrel', () => {
    const sourceFile = parseSourceFile(BARREL);
    const symbols = exportedSymbols(sourceFile);
    const doc = readDoc(EDITOR_MDX);

    expect(symbols.length).toBeGreaterThan(40);
    expect(doc.length).toBeGreaterThan(500);

    const { undocumented } = diffSets(
      symbols,
      symbols.filter((s) => mentionsToken(doc, s)),
    );

    expect(
      undocumented,
      `exports missing from ${EDITOR_MDX}: ${undocumented.join(', ')}`,
    ).toEqual([]);
  });
});

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  diffSets,
  exportedSymbols,
  mentionsToken,
  parseSourceFile,
  readDoc,
} from '../../test-utils/docs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BARREL = path.join(HERE, 'index.ts');
const CANVAS_MDX = 'reference/react-editor-canvas.mdx';

describe('docs coverage: react editor canvas', () => {
  it('documents every export from the canvas barrel', () => {
    const sourceFile = parseSourceFile(BARREL);
    const symbols = exportedSymbols(sourceFile);
    const doc = readDoc(CANVAS_MDX);

    expect(symbols.length).toBeGreaterThan(25);
    expect(doc.length).toBeGreaterThan(500);

    const { undocumented } = diffSets(
      symbols,
      symbols.filter((s) => mentionsToken(doc, s)),
    );

    expect(
      undocumented,
      `exports missing from ${CANVAS_MDX}: ${undocumented.join(', ')}`,
    ).toEqual([]);
  });
});

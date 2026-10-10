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
const MEDIA_MDX = 'reference/react-media.mdx';

describe('docs coverage: react media', () => {
  it('documents every export from the media barrel', () => {
    const sourceFile = parseSourceFile(BARREL);
    const symbols = exportedSymbols(sourceFile);
    const doc = readDoc(MEDIA_MDX);

    expect(symbols.length).toBeGreaterThan(20);
    expect(doc.length).toBeGreaterThan(500);

    const { undocumented } = diffSets(
      symbols,
      symbols.filter((s) => mentionsToken(doc, s)),
    );

    expect(
      undocumented,
      `exports missing from ${MEDIA_MDX}: ${undocumented.join(', ')}`,
    ).toEqual([]);
  });
});

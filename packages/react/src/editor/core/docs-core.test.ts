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
const CORE_MDX = 'reference/react-editor-core.mdx';

describe('docs coverage: react editor core', () => {
  it('documents every export from the core barrel', () => {
    const symbols = exportedSymbols(parseSourceFile(BARREL));
    const doc = readDoc(CORE_MDX);

    expect(symbols.length).toBeGreaterThan(30);

    const { undocumented } = diffSets(
      symbols,
      symbols.filter((s) => mentionsToken(doc, s)),
    );

    expect(
      undocumented,
      `exports missing from ${CORE_MDX}: ${undocumented.join(', ')}`,
    ).toEqual([]);
  });
});

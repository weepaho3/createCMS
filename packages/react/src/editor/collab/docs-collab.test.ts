import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { mentionsToken, readDoc } from '../../test-utils/docs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BARREL = path.join(HERE, 'index.ts');
const COLLAB_MDX = 'reference/react-editor-collab.mdx';

describe('docs coverage: react editor collab', () => {
  it('documents every export of the collab entry', () => {
    const source = readFileSync(BARREL, 'utf8');
    const symbols = [
      ...source.matchAll(/^export (?:type )?\{([^}]*)\}/gm),
    ].flatMap((match) =>
      match[1]!
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    );
    const doc = readDoc(COLLAB_MDX);
    expect(symbols.length).toBeGreaterThan(3);
    const undocumented = symbols.filter((s) => !mentionsToken(doc, s));
    expect(
      undocumented,
      `exports missing from ${COLLAB_MDX}: ${undocumented.join(', ')}`,
    ).toEqual([]);
  });
});

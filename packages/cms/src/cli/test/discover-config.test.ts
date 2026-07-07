import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONFIG_CANDIDATES, discoverConfig } from '../utils/discover-config';

describe('discoverConfig', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'createcms-discover-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // dx-14: the "not found" error lists exactly these, so keep them in sync.
  it('exports every discovered candidate path', () => {
    expect(CONFIG_CANDIDATES).toEqual([
      'cms.ts',
      'cms.js',
      'src/cms.ts',
      'src/cms.js',
      'src/lib/cms.ts',
      'src/lib/cms.js',
      'lib/cms.ts',
      'lib/cms.js',
    ]);
  });

  it('returns undefined when no config exists', async () => {
    expect(await discoverConfig(dir)).toBeUndefined();
  });

  it('finds a config, honoring the candidate priority order', async () => {
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await writeFile(path.join(dir, 'src/cms.ts'), '', 'utf8');
    await writeFile(path.join(dir, 'cms.ts'), '', 'utf8');

    // `cms.ts` outranks `src/cms.ts` in CONFIG_CANDIDATES.
    expect(await discoverConfig(dir)).toBe(path.join(dir, 'cms.ts'));
  });
});

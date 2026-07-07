import path from 'node:path';

import { fileExists } from './fs';

/** The project-relative paths `generate` auto-discovers, in priority order.
 *  Exported so the "not found" error can list exactly what was searched. */
export const CONFIG_CANDIDATES = [
  'cms.ts',
  'cms.js',
  'src/cms.ts',
  'src/cms.js',
  'src/lib/cms.ts',
  'src/lib/cms.js',
  'lib/cms.ts',
  'lib/cms.js',
];

export async function discoverConfig(cwd: string): Promise<string | undefined> {
  for (const candidate of CONFIG_CANDIDATES) {
    const fullPath = path.resolve(cwd, candidate);
    if (await fileExists(fullPath)) {
      return fullPath;
    }
  }
  return undefined;
}

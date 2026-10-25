import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EN_MESSAGES } from './core/messages';

const ROOT = import.meta.dirname;
const PART_DIRS = ['canvas', 'structure', 'field', 'preview'];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory())
      return name === 'test' ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.(test|type-check)\.tsx?$/.test(name)
      ? [path]
      : [];
  });
}

describe('parts take their texts from the catalog', () => {
  it('no default English text of the catalog appears as a literal in a part', () => {
    const texts = Object.values(EN_MESSAGES.parts).filter(
      (v): v is string => typeof v === 'string',
    );
    const offenders: string[] = [];
    for (const dir of PART_DIRS) {
      for (const file of sources(join(ROOT, dir))) {
        const source = readFileSync(file, 'utf8');
        for (const text of texts) {
          if (source.includes(`'${text}'`) || source.includes(`>${text}<`)) {
            offenders.push(`${file}: ${text}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

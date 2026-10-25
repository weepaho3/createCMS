import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = new URL('.', import.meta.url).pathname;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'test') out.push(...sources(path));
      continue;
    }
    if (/\.tsx?$/.test(name) && !/\.test\.|\.type-check\./.test(name)) {
      out.push(path);
    }
  }
  return out;
}

describe('canvas modules reach documents through their elements', () => {
  it('no module reads the global document or window', () => {
    const offenders: string[] = [];
    for (const file of sources(ROOT)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        const code = line.replace(/\/\/.*$/, '');
        if (/^\s*\*/.test(code)) return;
        if (/(^|[^.\w])(document|window)\.[a-zA-Z]/.test(code)) {
          offenders.push(`${file.slice(ROOT.length)}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});

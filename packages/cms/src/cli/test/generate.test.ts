import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SchemaSource } from '../../core/db/merge';

import { generateSchema } from '../../core/codegen/generate';
import { runGenerateCheck } from '../commands/generate';

const source: SchemaSource = {
  name: 'core',
  schema: {
    tables: {
      items: {
        columns: {
          id: {
            type: 'text',
            primaryKey: true,
            defaultId: true,
            defaultIdPrefix: 'item',
          },
        },
      },
    },
  },
};

describe('runGenerateCheck', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'createcms-check-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reports match when the on-disk schema is exactly what generate would write', async () => {
    const outputPath = path.join(dir, 'cms.ts');
    await generateSchema({ sources: [source], outputPath });

    const result = await runGenerateCheck({ sources: [source], outputPath });

    expect(result.status).toBe('match');
  });

  it('reports drift with a non-empty diff when the on-disk schema was hand-edited', async () => {
    const outputPath = path.join(dir, 'cms.ts');
    const { output: onDisk } = await generateSchema({
      sources: [source],
      outputPath,
    });
    await writeFile(outputPath, `${onDisk}\n// hand edit`, 'utf8');

    const result = await runGenerateCheck({ sources: [source], outputPath });

    expect(result.status).toBe('drift');
    if (result.status === 'drift') {
      expect(result.diff.length).toBeGreaterThan(0);
      expect(result.diff).toContain('schema drift');
    }
  });

  it('reports missing when no schema has been generated yet', async () => {
    const outputPath = path.join(dir, 'cms.ts');

    const result = await runGenerateCheck({ sources: [source], outputPath });

    expect(result.status).toBe('missing');
    if (result.status === 'missing') {
      expect(result.outputPath).toBe(outputPath);
    }
  });
});

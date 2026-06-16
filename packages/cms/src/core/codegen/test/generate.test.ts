import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SchemaSource } from '../../db/merge';

import { coreSchema } from '../../db/core-schema';
import { generateSchema } from '../generate';

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

describe('generateSchema', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'createcms-gen-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the emitted schema to disk + returns { outputPath, schema, output }', async () => {
    const out = path.join(dir, 'cms.ts');
    const result = await generateSchema({ sources: [source], outputPath: out });

    expect(result.outputPath).toBe(path.resolve(out)); // resolved absolute
    expect(Object.keys(result.schema.tables)).toEqual(['items']);
    const onDisk = await readFile(out, 'utf8');
    expect(onDisk).toBe(result.output); // file content === returned output
    expect(onDisk).toContain('export const items = cms.table(');
  });

  it('creates nested output directories (mkdir recursive)', async () => {
    const out = path.join(dir, 'nested/db/schema/cms.ts');
    const result = await generateSchema({ sources: [source], outputPath: out });
    expect(await readFile(out, 'utf8')).toBe(result.output);
  });

  it('generates the full core schema end-to-end', async () => {
    const out = path.join(dir, 'core.ts');
    const result = await generateSchema({
      sources: [{ name: 'core', schema: coreSchema }],
      outputPath: out,
    });

    const onDisk = await readFile(out, 'utf8');
    // emit puts the db name on the next line: `cms.table(\n  "roots",`
    expect(onDisk).toMatch(/export const roots = cms\.table\(\s+"roots",/);
    expect(onDisk).toMatch(
      /export const redirects = cms\.table\(\s+"redirects",/,
    );
    expect(Object.keys(result.schema.tables).length).toBeGreaterThan(15);
  });
});

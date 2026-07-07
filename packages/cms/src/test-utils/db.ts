import { PGlite } from '@electric-sql/pglite';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { drizzle } from 'drizzle-orm/pglite';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SchemaModule } from '../core/db/types';

import { coreSchema } from '../core/db/core-schema';
import { emitDrizzleSchema } from '../core/db/emit';
import { mergeSchemaSources, type SchemaSource } from '../core/db/merge';
import * as baseSchema from '../schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NANOID_SOURCE_PATH = path.resolve(__dirname, '../../src/utils/nanoid.ts');

/**
 * Merges core + plugin schemas via the codegen pipeline, writes a temp
 * file, dynamically imports it, and returns the Drizzle schema module.
 *
 * The temp file is created within the project directory (packages/cms/.test-schema/)
 * so that module resolution works correctly for imports like 'drizzle-orm'.
 */
async function generateMergedSchema(
  plugins: Array<{ name: string; schema: SchemaModule }>,
): Promise<{
  schema: Record<string, unknown>;
  cleanup: () => Promise<void>;
}> {
  const sources: SchemaSource[] = [
    { name: 'core', schema: coreSchema },
    ...plugins.map((p) => ({
      name: `plugin:${p.name}`,
      schema: p.schema as SchemaSource['schema'],
    })),
  ];

  const merged = mergeSchemaSources(sources);
  const code = emitDrizzleSchema(merged, {
    nanoidImport: `import { newId } from '${NANOID_SOURCE_PATH}';`,
  });

  // Use a directory within the project so module resolution works
  const tmpDir = path.resolve(__dirname, '../../.test-schema');
  await mkdir(tmpDir, { recursive: true });
  const tmpFile = path.join(
    tmpDir,
    `schema-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ts`,
  );
  await writeFile(tmpFile, code, 'utf8');

  try {
    const mod = await import(tmpFile);
    return {
      schema: mod,
      cleanup: async () => {
        await unlink(tmpFile).catch(() => {});
      },
    };
  } catch (err) {
    await unlink(tmpFile).catch(() => {});
    throw err;
  }
}

/**
 * Spins up an in-memory PGlite instance and applies the Drizzle schema.
 *
 * When `plugins` is provided, runs the full codegen pipeline (merge core +
 * plugin schemas -> emit -> temp file -> migrate). Otherwise uses the
 * pre-built `src/schema` directly for faster startup.
 */
export const setupTestDB = async (options?: {
  plugins?: Array<{ name: string; schema: SchemaModule }>;
}) => {
  const client = new PGlite();
  const db = drizzle(client, { schema: baseSchema });

  let cleanup: () => Promise<void> = async () => {};

  if (options?.plugins && options.plugins.length > 0) {
    const { schema: mergedSchema, cleanup: schemaCleanup } =
      await generateMergedSchema(options.plugins);
    cleanup = schemaCleanup;

    const prev = generateDrizzleJson({});
    const curr = generateDrizzleJson(mergedSchema, prev.id);
    const statements = await generateMigration(prev, curr);
    for (const stmt of statements) {
      await db.execute(stmt);
    }
  } else {
    const prev = generateDrizzleJson({});
    const curr = generateDrizzleJson(baseSchema, prev.id);
    const statements = await generateMigration(prev, curr);
    for (const stmt of statements) {
      await db.execute(stmt);
    }
  }

  return { db, client, cleanup };
};

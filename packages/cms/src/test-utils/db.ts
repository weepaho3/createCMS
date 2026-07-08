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
 *
 * The ESM module is evaluated in memory once imported, so the temp file is
 * unlinked immediately after import — nothing else references it on disk.
 * This runs inside the memoized migration generator, so it executes at most
 * once per schema-set.
 */
async function generateMergedSchema(
  plugins: Array<{ name: string; schema: SchemaModule }>,
): Promise<Record<string, unknown>> {
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
    return mod;
  } finally {
    // The module is resident in memory after import; remove the temp file.
    await unlink(tmpFile).catch(() => {});
  }
}

/**
 * Memoizes the generated migration SQL per schema-set. The DDL statements
 * emitted by `generateMigration` are identical for a given schema-set — the
 * random temp filename and snapshot `prev.id` are metadata that never appear
 * in the SQL, so they are excluded from the cache key.
 *
 * Only the SQL *generation* is cached; each `setupTestDB` call still spins up
 * its own fresh PGlite and replays these statements against it.
 *
 * The cached value is a Promise, so concurrent boots of the same schema-set
 * dedupe onto a single generation pass.
 */
const migrationCache = new Map<string, Promise<string[]>>();

async function getMigrationStatements(
  key: string,
  build: () => Promise<Record<string, unknown>>,
): Promise<string[]> {
  let cached = migrationCache.get(key);
  if (!cached) {
    cached = (async () => {
      const schema = await build();
      const prev = generateDrizzleJson({});
      const curr = generateDrizzleJson(schema, prev.id);
      return generateMigration(prev, curr);
    })();
    // Evict on failure so a later boot can retry instead of replaying a
    // permanently-rejected promise.
    cached.catch(() => {
      if (migrationCache.get(key) === cached) migrationCache.delete(key);
    });
    migrationCache.set(key, cached);
  }
  return cached;
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

  const plugins = options?.plugins;
  // The cache key is the ordered plugin-name list. This is sound only because
  // every call site maps a given name to ONE fixed schema module (a static const
  // or a no-arg builder). If a test ever passed the same `name` with a different
  // `schema`, it would replay the first schema's stale DDL — key on a content
  // hash of the emitted schema then (the emit is the expensive step we memoize,
  // so hashing it defeats the cache; keep names stable instead).
  const statements =
    plugins && plugins.length > 0
      ? await getMigrationStatements(
          `plugins:${plugins.map((p) => p.name).join('|')}`,
          () => generateMergedSchema(plugins),
        )
      : await getMigrationStatements('__base__', async () => baseSchema);

  for (const stmt of statements) {
    await db.execute(stmt);
  }

  // The migration SQL is memoized and the schema temp file is removed inside
  // the generator, so there is nothing left to clean up per call.
  const cleanup: () => Promise<void> = async () => {};

  return { db, client, cleanup };
};

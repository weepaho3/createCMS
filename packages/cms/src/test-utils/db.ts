import { PGlite } from '@electric-sql/pglite';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { drizzle } from 'drizzle-orm/pglite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SchemaModule } from '../core/db/types';

import { coreSchema } from '../core/db/core-schema';
import { emitDrizzleSchema } from '../core/db/emit';
import { mergeSchemaSources, type SchemaSource } from '../core/db/merge';
import * as baseSchema from '../schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const NANOID_SOURCE_PATH = path.resolve(__dirname, '../../src/utils/nanoid.ts');

const TMP_DIR = path.resolve(__dirname, '../../.test-schema');

/**
 * Merges core + plugin schemas via the codegen pipeline, writes a temp
 * file, dynamically imports it, and returns the Drizzle schema module.
 *
 * The temp file is created within the project directory (packages/cms/.test-schema/)
 * so that module resolution works correctly for imports like 'drizzle-orm'.
 *
 * The ESM module is evaluated in memory once imported, so the temp file is
 * unlinked immediately after import — nothing else references it on disk.
 * This runs inside the memoized data-dir builder, so it executes at most
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

  await mkdir(TMP_DIR, { recursive: true });
  const tmpFile = path.join(
    TMP_DIR,
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
 * Resolves the installed @electric-sql/pglite version by walking up from the
 * resolved entry point to its package.json (the package does not export
 * "./package.json", so it cannot be imported directly). The version is part
 * of the on-disk dump cache key: the data-dir format is version-specific, so
 * a PGlite upgrade must invalidate old dumps rather than fail restoring them.
 */
function pgliteVersion(): string {
  const require = createRequire(import.meta.url);
  let dir = path.dirname(require.resolve('@electric-sql/pglite'));
  while (true) {
    try {
      const pkg = JSON.parse(
        readFileSync(path.join(dir, 'package.json'), 'utf8'),
      ) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === '@electric-sql/pglite' && pkg.version)
        return pkg.version;
    } catch {
      // No package.json at this level — keep walking up.
    }
    const parent = path.dirname(dir);
    if (parent === dir) return 'unknown';
    dir = parent;
  }
}

/** Dumps older than this are pruned when a new one is written. */
const DUMP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Best-effort removal of stale dump files so schema churn during development
 * does not grow the cache dir unboundedly (each dump is ~40MB). Runs only on
 * the cache-miss path, so the hot path never pays for it.
 */
async function pruneStaleDumps(exclude: string): Promise<void> {
  try {
    const entries = await readdir(TMP_DIR);
    const cutoff = Date.now() - DUMP_MAX_AGE_MS;
    for (const entry of entries) {
      if (!entry.startsWith('pgdata-') || entry === exclude) continue;
      const file = path.join(TMP_DIR, entry);
      const info = await stat(file).catch(() => null);
      if (info && info.mtimeMs < cutoff) await unlink(file).catch(() => {});
    }
  } catch {
    // Pruning is opportunistic; a failure here must never fail a test.
  }
}

/**
 * Memoizes a *migrated data directory* per schema-set — in memory for this
 * module registry, and on disk (content-addressed) across processes and runs.
 *
 * A bare `new PGlite()` pays for `initdb` — bootstrapping the Postgres system
 * catalogs — which dominates setup (~660ms of a ~730ms boot on an M-series
 * Mac; the ~170 DDL statements are only ~70ms of it). Restoring a dump skips
 * initdb entirely (~150ms). With 500+ `setupTestCMS` calls in the suite that
 * is the difference between a CI test step measured in minutes and one
 * measured in seconds.
 *
 * The in-memory map alone is not enough: vitest isolates the module registry
 * per test *file*, so a module-level cache is rebuilt by every file. The disk
 * layer (packages/cms/.test-schema/pgdata-<hash>.tar) makes the template
 * build a once-per-schema-change cost instead of once-per-file. The file is
 * keyed by a hash of the PGlite version plus the exact DDL, so it can never
 * go stale: any schema or PGlite change produces a new file. Concurrent
 * workers may race to build the same dump on a cold cache; each writes to a
 * pid-suffixed temp file and renames it into place, which is atomic, so
 * readers only ever see complete dumps.
 *
 * The cached value is a Promise, so concurrent boots of the same schema-set
 * within one file dedupe onto a single build (or disk read).
 */
const dataDirCache = new Map<string, Promise<Blob>>();

async function getMigratedDataDir(
  key: string,
  build: () => Promise<Record<string, unknown>>,
): Promise<Blob> {
  let cached = dataDirCache.get(key);
  if (!cached) {
    cached = (async () => {
      const schema = await build();
      const prev = generateDrizzleJson({});
      const curr = generateDrizzleJson(schema, prev.id);
      const statements = await generateMigration(prev, curr);

      // The emitted DDL fully determines the migrated data dir, so it (plus
      // the PGlite version, for the on-disk format) is the content address.
      const hash = createHash('sha256')
        .update(pgliteVersion())
        .update('\0')
        .update(statements.join('\n'))
        .digest('hex')
        .slice(0, 16);
      const dumpName = `pgdata-${hash}.tar`;
      const dumpPath = path.join(TMP_DIR, dumpName);

      // Disk hit: reconstruct the File PGlite dumps ('application/x-tar' is
      // how loadDataDir knows the payload is uncompressed tar).
      const existing = await readFile(dumpPath).catch(() => null);
      if (existing) {
        return new File([new Uint8Array(existing)], 'pgdata.tar', {
          type: 'application/x-tar',
        });
      }

      // Cold cache: boot a template, replay the DDL, dump it, persist.
      const template = new PGlite();
      const db = drizzle(template, { schema: baseSchema });
      for (const stmt of statements) {
        await db.execute(stmt);
      }
      // 'none': the dump is handed straight back to `loadDataDir`, so gzip
      // would only cost CPU on both ends. The template is NOT closed — see
      // releaseClientsFrom for why close() is never safe here; dropping the
      // reference lets the GC reclaim it.
      const dump = await template.dumpDataDir('none');

      await mkdir(TMP_DIR, { recursive: true });
      const tmpPath = `${dumpPath}.${process.pid}.tmp`;
      await writeFile(tmpPath, new Uint8Array(await dump.arrayBuffer()));
      await rename(tmpPath, dumpPath);
      await pruneStaleDumps(dumpName);

      return dump;
    })();
    // Evict on failure so a later boot can retry instead of replaying a
    // permanently-rejected promise.
    cached.catch(() => {
      if (dataDirCache.get(key) === cached) dataDirCache.delete(key);
    });
    dataDirCache.set(key, cached);
  }
  return cached;
}

/**
 * Worker-process-global state, stashed on globalThis because vitest resets
 * the module registry per test *file* — module-level state would be rebuilt
 * by every file, while the process (and therefore this object) lives on.
 *
 * `shared` holds ONE long-lived PGlite per schema-set, reused by every test
 * in the worker with a TRUNCATE-based reset between hand-outs. This is not
 * an optimization but a correctness requirement on Linux: dropped PGlite
 * instances are never reclaimed there — not even by an explicit gc() — so
 * every instance costs its ~200MB+ WASM heap permanently. A suite that boots
 * one instance per test (500+ boots) inevitably OOMs a 16GB CI runner; a
 * handful of persistent instances per worker stays bounded everywhere.
 * (On macOS the GC does reclaim dropped instances, which is why the leak
 * never showed locally.)
 *
 * `testSeq` counts tests (bumped by vitest.setup.ts) so `setupTestDB` can
 * detect a second call within the same test and hand out a fresh throwaway
 * instance instead of the shared one — two callers inside one test must not
 * see each other's data.
 */
type SharedDB = { client: PGlite; handedOutInSeq: number };
type TestDBGlobals = {
  shared: Map<string, Promise<SharedDB>>;
  testSeq: number;
};
const testDBGlobals: TestDBGlobals = ((
  globalThis as { __createcmsTestDB?: TestDBGlobals }
).__createcmsTestDB ??= { shared: new Map(), testSeq: 0 });

/** Called by vitest.setup.ts at every test start. */
export function beginTest(): number {
  testDBGlobals.testSeq += 1;
  return markClientBoundary();
}

/**
 * Every *throwaway* PGlite client opened by `setupTestDB` (second and later
 * DBs within a single test), in creation order. The global hooks in
 * vitest.setup.ts drain this registry after each test; the shared singletons
 * above are deliberately NOT in here — they live until the worker exits.
 */
const openClients: PGlite[] = [];

/** Snapshot the registry length; pass it to `releaseClientsFrom` later. */
export function markClientBoundary(): number {
  return openClients.length;
}

/**
 * Releases every client opened at or after `index` by dropping all
 * references and nudging the GC.
 *
 * Deliberately does NOT call `client.close()`: PGlite 0.5.x's WASM shutdown
 * busy-loops forever on some close calls (reproduced deterministically in
 * this suite — the 4th close in a file pegs the CPU and never returns; the
 * spin is synchronous, so it cannot even be raced against a timeout). An
 * unreferenced instance is plain JS objects plus a WASM ArrayBuffer, and V8
 * tracks that external memory, so ordinary GC pressure reclaims it promptly
 * — verified: the full suite stays bounded (a few GB per worker) on release
 * alone. The gc() call is opportunistic: Vitest 4 offers no way to pass
 * --expose-gc to workers, so it is normally undefined; it only kicks in if
 * the runtime exposes it (e.g. NODE_OPTIONS=--expose-gc).
 */
export async function releaseClientsFrom(index: number): Promise<void> {
  openClients.splice(index);
  (globalThis as { gc?: () => void }).gc?.();
}

/**
 * Spins up an in-memory PGlite instance and applies the Drizzle schema.
 *
 * When `plugins` is provided, runs the full codegen pipeline (merge core +
 * plugin schemas -> emit -> temp file -> migrate). Otherwise uses the
 * pre-built `src/schema` directly for faster startup.
 */
/**
 * Empties every user table on the shared instance so the next test starts
 * from a blank database. TRUNCATE (instead of DROP SCHEMA + DDL replay)
 * keeps enums, indexes and defaults intact and resets identity sequences in
 * one statement.
 */
async function resetSharedDB(client: PGlite): Promise<void> {
  // The generated schema lives in its own "cms" pg schema (not public), and
  // plugins may add more — collect every non-system table.
  const tables = await client.query<{ schemaname: string; tablename: string }>(
    `SELECT schemaname, tablename FROM pg_tables
     WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`,
  );
  if (tables.rows.length === 0) return;
  const list = tables.rows
    .map((r) => `"${r.schemaname}"."${r.tablename}"`)
    .join(', ');
  await client.exec(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export const setupTestDB = async (options?: {
  plugins?: Array<{ name: string; schema: SchemaModule }>;
  /**
   * Forces a private throwaway instance instead of the shared per-worker
   * singleton. Required for tests that mutate the SCHEMA (ALTER/CREATE
   * TABLE): the truncate reset only clears rows, so DDL would leak into
   * every later test on the shared instance. Costs a full instance — use
   * only where needed.
   */
  isolated?: boolean;
}) => {
  const plugins = options?.plugins;
  // The cache/singleton key is the ordered plugin-name list. This is sound
  // only because every call site maps a given name to ONE fixed schema module
  // (a static const or a no-arg builder). If a test ever passed the same
  // `name` with a different `schema`, it would reuse the first schema's
  // instance — the disk layer is immune (content-addressed), but the
  // singleton would still be stale. Keep names stable.
  const key =
    plugins && plugins.length > 0
      ? `plugins:${plugins.map((p) => p.name).join('|')}`
      : '__base__';
  const build = () =>
    plugins && plugins.length > 0
      ? getMigratedDataDir(key, () => generateMergedSchema(plugins))
      : getMigratedDataDir('__base__', async () => baseSchema);

  if (options?.isolated) {
    const client = new PGlite({ loadDataDir: await build() });
    openClients.push(client);
    const db = drizzle(client, { schema: baseSchema });
    return { db, client, cleanup: async () => {} };
  }

  let sharedPromise = testDBGlobals.shared.get(key);
  if (!sharedPromise) {
    sharedPromise = (async (): Promise<SharedDB> => {
      // Restores the already-migrated template: the schema is in place on
      // boot and no DDL runs here.
      const client = new PGlite({ loadDataDir: await build() });
      await client.waitReady;
      return { client, handedOutInSeq: -1 };
    })();
    sharedPromise.catch(() => {
      if (testDBGlobals.shared.get(key) === sharedPromise) {
        testDBGlobals.shared.delete(key);
      }
    });
    testDBGlobals.shared.set(key, sharedPromise);
  }
  const shared = await sharedPromise;

  let client: PGlite;
  if (shared.handedOutInSeq === testDBGlobals.testSeq) {
    // Second DB within the same test: a fresh throwaway instance, released
    // by the vitest.setup.ts hooks right after the test. Rare enough that
    // the Linux no-reclaim behaviour stays harmless.
    client = new PGlite({ loadDataDir: await build() });
    openClients.push(client);
  } else {
    shared.handedOutInSeq = testDBGlobals.testSeq;
    await resetSharedDB(shared.client);
    client = shared.client;
  }

  const db = drizzle(client, { schema: baseSchema });

  // The data dir is memoized, the schema temp file is removed inside the
  // generator, and instance lifetimes are owned by the vitest.setup.ts hooks
  // (throwaways) or the worker process (shared) — nothing to clean up per
  // call.
  const cleanup: () => Promise<void> = async () => {};

  return { db, client, cleanup };
};

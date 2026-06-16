import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';

import * as schema from '../db/schema';

/**
 * The Drizzle database the CMS reads and writes.
 *
 * This example uses **PGlite** (an in-process Postgres) so it runs with zero
 * external database setup. The schema is the one `createcms generate` emitted
 * into `db/schema.ts` (the content-agnostic core versioning tables).
 *
 * `bootstrapped` applies the schema to the fresh in-memory database once, on
 * first import. Pages that read CMS data await it (see `lib/cms-data.ts`).
 *
 * In a real app you would swap this for a persistent Postgres connection
 * (e.g. `drizzle-orm/node-postgres`) and apply the schema with
 * `drizzle-kit migrate` instead.
 */
const client = new PGlite();

export const db = drizzle(client, { schema });

/**
 * Applies the generated schema to the in-memory PGlite instance. We use
 * drizzle-kit's programmatic migration API to diff an empty database against
 * the generated schema and run the resulting DDL.
 */
async function applySchema(): Promise<void> {
  const { generateDrizzleJson, generateMigration } =
    await import('drizzle-kit/api');
  const prev = generateDrizzleJson({});
  const curr = generateDrizzleJson(schema as Record<string, unknown>, prev.id);
  const statements = await generateMigration(prev, curr);
  for (const stmt of statements) {
    await db.execute(stmt);
  }
}

/**
 * Resolves once the in-memory schema has been applied. Import and `await`
 * this before any CMS read in a Server Component.
 */
export const bootstrapped: Promise<void> = applySchema();

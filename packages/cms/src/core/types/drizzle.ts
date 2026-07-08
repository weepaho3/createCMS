import type { TablesRelationalConfig } from 'drizzle-orm';
import type { PgDatabase, PgTransaction } from 'drizzle-orm/pg-core';

/**
 * The drizzle handle the CMS runs its queries through.
 *
 * The CMS is schema-agnostic: it never uses drizzle's relational query builder
 * (`db.query.*`), only the schema-less core builder (`db.select()/insert()/
 * update()/delete()` and `db.execute(sql\`…\`)`). So `DrizzleInstance` is kept
 * as a wide SUPERTYPE that any `drizzle(...)` instance is assignable to, rather
 * than threading the caller's generated schema through every internal boundary
 * (which would buy no extra safety and force every consumer to specialize this
 * alias). Concretely:
 *
 * - `TSchema` is pinned to drizzle's own `TablesRelationalConfig` bound instead
 *   of `any` — a small honest tightening, safe because nothing here touches
 *   `db.query`.
 * - The query-result HKT (first param) is intentionally left `any`. Pinning it
 *   to `PgQueryResultHKT` makes every `db.execute(sql\`…\`)` row `unknown`
 *   (~76 raw-SQL call sites across the route layer), which would require typing
 *   each `execute` individually — out of scope for this alias. `any` preserves
 *   the "raw SQL rows are caller-asserted" contract those sites already rely on.
 */
export type DrizzleInstance = PgDatabase<
  any,
  Record<string, unknown>,
  TablesRelationalConfig
>;

/**
 * A drizzle handle a helper may run against: the outer connection OR an open
 * transaction opened via `db.transaction(async (tx) => …)`.
 *
 * A pg transaction is structurally a {@link DrizzleInstance} already —
 * drizzle's `PgTransaction` extends `PgDatabase` — so a `tx` is assignable to
 * `DrizzleInstance` without a cast. This union exists to make that contract
 * explicit at the signatures of the transaction-aware route helpers (slug
 * uniqueness, scoped insert, path resolution, …): naming `PgTransaction` in the
 * type documents that those helpers are meant to be called from inside a
 * transaction, and it stays honest if `DrizzleInstance`'s query-result generic
 * is ever tightened away from `any`. Callers pass either `db` or `tx` — the
 * `tx as any` casts these signatures used to force are gone.
 */
export type DbOrTx =
  | DrizzleInstance
  | PgTransaction<any, Record<string, unknown>, TablesRelationalConfig>;

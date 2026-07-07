import { sql, type SQL } from 'drizzle-orm';

import type { RootTableScope, TableScope } from './types/definitions';
import type { DbOrTx, DrizzleInstance } from './types/drizzle';

const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_.]*$/i;
const SAFE_COLUMN = /^[a-z_][a-z0-9_]*$/i;

/**
 * Equality conditions for plugin-owned scope columns (e.g. `tenant_slug`)
 * against an UN-ALIASED `cms.roots`, fully qualified so they bind in raw-SQL
 * read paths that want defensive scope filtering (a referenced or ancestor root
 * must be in the active scope). `exclude` drops columns the caller handles
 * separately (a scoping plugin whose column varies independently of the query).
 * Column names are validated; values are parameterized. Returns `[]` when no
 * scoping is active.
 */
export function rootScopeConditions(
  scopeColumns: Record<string, unknown> | undefined,
  exclude: readonly string[] = [],
): SQL[] {
  return tableScopeConditions('roots', scopeColumns, exclude);
}

/**
 * Like {@link rootScopeConditions} but against an un-aliased `cms.variables` —
 * for the variable resolver's tenant filtering (`language` excluded, since the
 * fallback chain resolves it, not a hard equality).
 */
export function variableScopeConditions(
  scopeColumns: Record<string, unknown> | undefined,
  exclude: readonly string[] = [],
): SQL[] {
  return tableScopeConditions('variables', scopeColumns, exclude);
}

function tableScopeConditions(
  table: string,
  scopeColumns: Record<string, unknown> | undefined,
  exclude: readonly string[] = [],
): SQL[] {
  if (!scopeColumns) return [];
  const conds: SQL[] = [];
  for (const [col, val] of Object.entries(scopeColumns)) {
    if (val === undefined || val === null || exclude.includes(col)) continue;
    if (!SAFE_COLUMN.test(col)) {
      throw new Error(`tableScopeConditions: unsafe scope column "${col}"`);
    }
    conds.push(
      sql`"cms".${sql.raw(`"${table}"`)}.${sql.raw(`"${col}"`)} = ${val}`,
    );
  }
  return conds;
}

/**
 * The roots scope columns for CROSS-scope read filtering: the static insert
 * columns MINUS the plugin-declared `crossScopeExclude` (columns the plugin
 * varies INDEPENDENTLY of a query — e.g. the i18n plugin's `language`). Pass the
 * result to reads that legitimately span those columns (reference / host /
 * usage / co-render reads, the published-root load) so they are NOT filtered by
 * them. Core names no specific column. (Seam D6.)
 */
export function crossScopeColumns(
  rootScope: RootTableScope | undefined,
): Record<string, unknown> | undefined {
  const cols = rootScope?.insertColumns;
  const exclude = rootScope?.crossScopeExclude;
  if (!cols || !exclude?.length) return cols;
  return Object.fromEntries(
    Object.entries(cols).filter(([k]) => !exclude.includes(k)),
  );
}

function assertSafeIdentifier(name: string): void {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(`Unsafe SQL identifier rejected: "${name}"`);
  }
}

/**
 * Builds a single raw SQL INSERT that includes both the Drizzle-known columns
 * and any plugin-injected scope columns (e.g. `tenant_slug`) in one statement.
 *
 * Returns all columns via RETURNING *.
 */
export async function scopedInsert<T extends Record<string, unknown>>(
  db: DbOrTx,
  tableName: string,
  values: T,
  scope: TableScope | undefined,
): Promise<T & Record<string, unknown>> {
  assertSafeIdentifier(tableName);
  const merged = { ...values, ...scope?.insertColumns };
  const entries = Object.entries(merged);

  const columns = sql.join(
    entries.map(([col]) => {
      assertSafeIdentifier(col);
      return sql.raw(`"${col}"`);
    }),
    sql`, `,
  );
  const params = sql.join(
    entries.map(([, val]) => sql`${val ?? null}`),
    sql`, `,
  );

  const result = await db.execute(
    sql`INSERT INTO ${sql.raw(tableName)} (${columns}) VALUES (${params}) RETURNING *`,
  );

  if (!result.rows[0]) {
    throw new Error(`scopedInsert into ${tableName} returned no rows`);
  }
  return result.rows[0] as T & Record<string, unknown>;
}

/**
 * Batch variant — inserts multiple rows in a single raw SQL INSERT with
 * scope columns merged into every row.
 *
 * Returns all inserted rows via RETURNING *.
 */
export async function scopedInsertBatch<T extends Record<string, unknown>>(
  db: DrizzleInstance,
  tableName: string,
  rows: T[],
  scope: TableScope | undefined,
): Promise<(T & Record<string, unknown>)[]> {
  if (rows.length === 0) return [];

  assertSafeIdentifier(tableName);
  const sampleMerged = { ...rows[0], ...scope?.insertColumns };
  const columnNames = Object.keys(sampleMerged);

  const columns = sql.join(
    columnNames.map((col) => {
      assertSafeIdentifier(col);
      return sql.raw(`"${col}"`);
    }),
    sql`, `,
  );

  const valueTuples = rows.map((row) => {
    const merged = { ...row, ...scope?.insertColumns };
    const params = sql.join(
      columnNames.map((col) => sql`${merged[col] ?? null}`),
      sql`, `,
    );
    return sql`(${params})`;
  });

  const valuesList = sql.join(valueTuples, sql`, `);

  const result = await db.execute(
    sql`INSERT INTO ${sql.raw(tableName)} (${columns}) VALUES ${valuesList} RETURNING *`,
  );

  if (result.rows.length !== rows.length) {
    throw new Error(
      `scopedInsertBatch into ${tableName}: expected ${rows.length} rows, got ${result.rows.length}`,
    );
  }
  return result.rows as (T & Record<string, unknown>)[];
}

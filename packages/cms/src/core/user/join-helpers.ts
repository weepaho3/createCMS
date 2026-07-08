import { sql, type SQL } from 'drizzle-orm';

import type { DrizzleInstance } from '../types/drizzle';
import type { ResolvedUserConfig } from './resolve';

import { assertSafeSqlIdentifier, assertSafeSqlTableRef } from './resolve';

/**
 * Resolves which user-table columns to include based on the `withUser` value.
 * Returns camelCase column keys (matching the Drizzle table definition).
 *
 * Every result is intersected with `userConfig.exposeColumns` — the allowlist
 * is a hard security boundary, so a column not on it is never returned, even
 * when explicitly requested via `withUser: { someColumn: true }`.
 */
export function resolveUserColumns(
  userConfig: ResolvedUserConfig,
  withUser: true | Record<string, true>,
): string[] {
  const allowed = new Set(userConfig.exposeColumns);
  if (withUser === true) {
    return userConfig.exposeColumns.filter((k) => k !== userConfig.idColumnKey);
  }
  return Object.keys(withUser).filter((k) => allowed.has(k));
}

/**
 * Builds raw SQL fragments for a LEFT JOIN to the user table.
 * Used by endpoints that construct queries with `db.execute(sql`...`)`.
 */
export function userJoinFragments(
  userConfig: ResolvedUserConfig,
  cmsColumn: string,
  alias: string,
  withUser: true | Record<string, true>,
): {
  selectColumns: SQL;
  joinClause: SQL;
  groupByColumns: SQL;
} {
  const columns = resolveUserColumns(userConfig, withUser);

  if (columns.length === 0) {
    return {
      selectColumns: sql.raw(''),
      joinClause: sql.raw(''),
      groupByColumns: sql.raw(''),
    };
  }

  // Defense-in-depth: everything below is spliced into raw SQL via `sql.raw`,
  // so validate every identifier that originates from the (developer-provided)
  // user config before it lands in a fragment. `resolveUserConfig` already
  // validates these at construction; re-assert here so a hand-built
  // `ResolvedUserConfig` can never bypass the guard.
  assertSafeSqlTableRef(userConfig.sqlTableRef);
  assertSafeSqlIdentifier(userConfig.idColumnDbName, 'user id column');

  const selectParts = columns
    .map((c) => {
      const dbName = userConfig.allColumns[c]!.name;
      assertSafeSqlIdentifier(dbName, `user column "${c}"`);
      return `${alias}.${dbName} AS ${alias}_${c}`;
    })
    .join(', ');

  const joinStr =
    `LEFT JOIN ${userConfig.sqlTableRef} AS ${alias}` +
    ` ON ${alias}.${userConfig.idColumnDbName} = ${cmsColumn}`;

  const groupByParts = columns
    .map((c) => `${alias}.${userConfig.allColumns[c]!.name}`)
    .join(', ');

  return {
    selectColumns: sql.raw(`, ${selectParts}`),
    joinClause: sql.raw(joinStr),
    groupByColumns: sql.raw(`, ${groupByParts}`),
  };
}

/**
 * Combines JOIN fragments for multiple user-ID fields in a single query.
 * Each field gets its own aliased LEFT JOIN to the user table.
 */
export function multiUserJoinFragments(
  uc: ResolvedUserConfig,
  fields: Array<{ cmsColumn: string; alias: string }>,
  withUser: true | Record<string, true>,
): { selectColumns: SQL; joinClause: SQL; groupByColumns: SQL } {
  const parts = fields.map((f) =>
    userJoinFragments(uc, f.cmsColumn, f.alias, withUser),
  );

  return {
    selectColumns: sql.join(
      parts.map((p) => p.selectColumns),
      sql.raw(''),
    ),
    joinClause: sql.join(
      parts.map((p) => p.joinClause),
      sql.raw(' '),
    ),
    groupByColumns: sql.join(
      parts.map((p) => p.groupByColumns),
      sql.raw(''),
    ),
  };
}

/**
 * Extracts user data from a raw SQL result row into a sibling object.
 * Maps `${alias}_${columnKey}` row fields to `{ columnKey: value }`.
 */
export function extractUserFromRow(
  row: Record<string, unknown>,
  alias: string,
  userConfig: ResolvedUserConfig,
  withUser: true | Record<string, true>,
): Record<string, unknown> | null {
  const columns = resolveUserColumns(userConfig, withUser);
  if (columns.length === 0) return null;

  const result: Record<string, unknown> = {};
  let hasValue = false;
  for (const c of columns) {
    const rowKey = `${alias}_${c}`;
    result[c] = row[rowKey] ?? null;
    if (row[rowKey] != null) hasValue = true;
  }

  return hasValue ? result : null;
}

/**
 * Batch-fetches user data for a set of user IDs and returns a lookup map.
 * Shared by endpoints that use the Drizzle Query Builder (not raw SQL JOINs).
 */
export async function batchFetchUsers(
  db: DrizzleInstance,
  uc: ResolvedUserConfig,
  withUser: true | Record<string, true>,
  userIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (userIds.length === 0) return map;

  // `idColumnDbName` and `sqlTableRef` are spliced into the raw SELECT/FROM
  // below independently of `userJoinFragments` (which skips validation when no
  // columns match), so guard them here too.
  assertSafeSqlIdentifier(uc.idColumnDbName, 'user id column');
  assertSafeSqlTableRef(uc.sqlTableRef);

  const frags = userJoinFragments(uc, `u.${uc.idColumnDbName}`, 'u', withUser);
  const userRows = await db.execute(
    sql`SELECT ${sql.raw(uc.idColumnDbName)} AS user_id ${frags.selectColumns} FROM ${sql.raw(uc.sqlTableRef)} AS u WHERE u.${sql.raw(uc.idColumnDbName)} = ANY(${userIds})`,
  );

  for (const ur of userRows.rows as Array<Record<string, unknown>>) {
    const userData = extractUserFromRow(ur, 'u', uc, withUser);
    if (userData) map.set(ur.user_id as string, userData);
  }

  return map;
}

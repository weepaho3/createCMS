import type { AnyColumn } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';

import { getTableColumns, getTableName } from 'drizzle-orm';

/**
 * Defense-in-depth guards for identifiers that get spliced into raw SQL
 * (`sql.raw(...)`) by the user-enrichment JOIN helpers. Mirrors the guard in
 * `core/scope.ts`: table/schema/column names are developer-controlled today, but
 * validate them anyway so a name can never break out of the raw fragment.
 */
const SAFE_SQL_IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;
// A fully-quoted table reference: `"table"` or `"schema"."table"`.
const SAFE_SQL_TABLE_REF = /^"[a-z_][a-z0-9_]*"(\."[a-z_][a-z0-9_]*")?$/i;

export function assertSafeSqlIdentifier(name: string, kind: string): void {
  if (!SAFE_SQL_IDENTIFIER.test(name)) {
    throw new Error(
      `[cms] unsafe SQL identifier rejected (${kind}): "${name}"`,
    );
  }
}

export function assertSafeSqlTableRef(ref: string): void {
  if (!SAFE_SQL_TABLE_REF.test(ref)) {
    throw new Error(`[cms] unsafe SQL table reference rejected: "${ref}"`);
  }
}

export type ResolvedUserConfig = {
  table: AnyPgTable;
  tableName: string;
  schemaName: string | null;
  idColumn: AnyColumn;
  /** The camelCase key used in the Drizzle table definition (e.g. "id"). */
  idColumnKey: string;
  /** The actual database column name (e.g. "id" or "user_id"). */
  idColumnDbName: string;
  allColumns: Record<string, AnyColumn>;
  /** Allowlist (camelCase keys) of columns exposable via `withUser`. */
  exposeColumns: string[];
  sqlTableRef: string;
};

/**
 * Resolves a user config into runtime metadata.
 *
 * `exposeColumns` is the security boundary for `withUser`: it is the allowlist
 * of columns that may ever be returned to a client. It is REQUIRED — omitting it
 * would silently expose every user column (password hashes, tokens, …), so the
 * resolver throws rather than defaulting to a permissive "all columns". The
 * public `CMSUserConfig` also requires it at the type level; this runtime check
 * closes the gap for untyped (JS) consumers.
 */
export function resolveUserConfig(config: {
  table: AnyPgTable;
  idColumn: AnyColumn;
  exposeColumns?: string[];
}): ResolvedUserConfig {
  const table = config.table;

  const tableName = getTableName(table);
  assertSafeSqlIdentifier(tableName, 'user table name');
  const schemaName: string | undefined =
    (table as any)[Symbol.for('drizzle:Schema')] ?? undefined;
  if (schemaName !== undefined) {
    assertSafeSqlIdentifier(schemaName, 'user table schema');
  }
  const columns: Record<string, AnyColumn> = getTableColumns(table);

  const idColumn = config.idColumn;
  const idColumnKey = Object.entries(columns).find(
    ([, col]) => col === idColumn,
  )?.[0];

  if (!idColumnKey) {
    throw new Error(
      `[cms] user config: idColumn "${idColumn.name}" not found on table "${tableName}". ` +
        `Available columns: ${Object.keys(columns).join(', ')}`,
    );
  }
  assertSafeSqlIdentifier(idColumn.name, 'user id column');

  const sqlTableRef = schemaName
    ? `"${schemaName}"."${tableName}"`
    : `"${tableName}"`;

  // `exposeColumns` is the security allowlist for `withUser`. Never default it —
  // an omitted list must fail loudly, not silently expose every column.
  if (config.exposeColumns === undefined) {
    throw new Error(
      '[cms] user.exposeColumns is required — it is the security allowlist for ' +
        '`withUser`; list only the columns safe to return (never password ' +
        'hashes/tokens).',
    );
  }

  // Restrict the allowlist to columns that actually exist, excluding the id
  // column, and validate every resolved db column name that will be spliced
  // into raw SQL by the JOIN helpers.
  const exposeColumns = config.exposeColumns.filter(
    (c) => c !== idColumnKey && c in columns,
  );
  for (const c of exposeColumns) {
    assertSafeSqlIdentifier(columns[c]!.name, `user column "${c}"`);
  }

  return {
    table: config.table,
    tableName,
    schemaName: schemaName ?? null,
    idColumn,
    idColumnKey,
    idColumnDbName: idColumn.name,
    allColumns: columns,
    exposeColumns,
    sqlTableRef,
  };
}

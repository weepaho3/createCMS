import type { AnyColumn } from 'drizzle-orm';
import type { AnyPgTable } from 'drizzle-orm/pg-core';

import { getTableColumns, getTableName } from 'drizzle-orm';

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
 * `exposeColumns` is the security boundary for `withUser`. The public
 * `CMSUserConfig` requires it; here it is optional only so internal/test
 * callers can resolve table metadata without one — in that case it defaults
 * to every non-id column (the resolver itself enforces nothing; the public
 * API does).
 */
export function resolveUserConfig(config: {
  table: AnyPgTable;
  idColumn: AnyColumn;
  exposeColumns?: string[];
}): ResolvedUserConfig {
  const table = config.table;

  const tableName = getTableName(table);
  const schemaName: string | undefined =
    (table as any)[Symbol.for('drizzle:Schema')] ?? undefined;
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

  const sqlTableRef = schemaName
    ? `"${schemaName}"."${tableName}"`
    : `"${tableName}"`;

  // Restrict the allowlist to columns that actually exist, excluding the id
  // column. When no allowlist is provided (internal/test callers), default to
  // every non-id column.
  const exposeColumns = (config.exposeColumns ?? Object.keys(columns)).filter(
    (c) => c !== idColumnKey && c in columns,
  );

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

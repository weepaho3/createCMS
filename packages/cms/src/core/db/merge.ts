import type {
  CompositePrimaryKey,
  EnumDefinition,
  IndexDefinition,
  MergedSchema,
  ResolvedEnum,
  ResolvedTable,
  SchemaModule,
  TableColumns,
  TableDefinition,
  TableExtension,
  TableLevelForeignKey,
} from './types';

export type SchemaSource = {
  name: string;
  schema: SchemaModule;
};

export function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

function cloneColumns(columns: TableColumns): TableColumns {
  return Object.fromEntries(
    Object.entries(columns).map(([key, value]) => [key, { ...value }]),
  );
}

function cloneIndexes(
  indexes: ResolvedTable['indexes'],
): ResolvedTable['indexes'] {
  return Object.fromEntries(
    Object.entries(indexes).map(([key, value]) => [
      key,
      {
        ...value,
        columns: [...value.columns],
      },
    ]),
  );
}

function cloneEnum(enumDef: EnumDefinition): ResolvedEnum {
  return {
    ...enumDef,
    key: '',
    dbName: '',
    values: [...enumDef.values],
  };
}

export function mergeSchemaSources(sources: SchemaSource[]): MergedSchema {
  const enums: Record<string, ResolvedEnum> = {};
  const tables: Record<string, ResolvedTable> = {};

  for (const source of sources) {
    const sourceEnums = source.schema.enums ?? {};
    for (const [enumKey, enumDef] of Object.entries(sourceEnums) as Array<
      [string, EnumDefinition]
    >) {
      if (enums[enumKey]) {
        throw new Error(
          `Duplicate enum "${enumKey}" declared by "${source.name}".`,
        );
      }

      const resolved = cloneEnum(enumDef);
      resolved.key = enumKey;
      resolved.dbName = enumDef.enumName ?? toSnakeCase(enumKey);
      enums[enumKey] = resolved;
    }

    const sourceTables = source.schema.tables ?? {};
    for (const [tableKey, tableDef] of Object.entries(sourceTables) as Array<
      [string, TableDefinition]
    >) {
      if (tables[tableKey]) {
        throw new Error(
          `Duplicate table "${tableKey}" declared by "${source.name}".`,
        );
      }

      const resolved: ResolvedTable = {
        key: tableKey,
        dbName: tableDef.tableName ?? toSnakeCase(tableKey),
        indexPrefix: tableDef.indexPrefix,
        columns: cloneColumns(tableDef.columns),
        indexes: cloneIndexes(
          Object.fromEntries(
            (
              Object.entries(tableDef.indexes ?? {}) as Array<
                [string, IndexDefinition<string>]
              >
            ).map(([indexKey, indexDef]) => [
              indexKey,
              {
                ...indexDef,
                columns: [...indexDef.columns],
              },
            ]),
          ),
        ),
        compositePrimaryKey: tableDef.compositePrimaryKey
          ? {
              columns: [
                ...(tableDef.compositePrimaryKey as CompositePrimaryKey<string>)
                  .columns,
              ],
            }
          : undefined,
        foreignKeys: tableDef.foreignKeys
          ? (tableDef.foreignKeys as TableLevelForeignKey[]).map((fk) => ({
              ...fk,
              columns: [...fk.columns],
              foreignColumns: [...fk.foreignColumns],
            }))
          : undefined,
      };

      tables[tableKey] = resolved;
    }
  }

  // Apply extensions
  for (const source of sources) {
    const sourceExtensions = source.schema.extend ?? {};
    for (const [targetTableKey, extension] of Object.entries(
      sourceExtensions,
    ) as Array<[string, TableExtension<TableColumns, TableColumns>]>) {
      const targetTable = tables[targetTableKey];
      if (!targetTable) {
        throw new Error(
          `Schema source "${source.name}" extends unknown table "${targetTableKey}".`,
        );
      }

      for (const [columnKey, columnDef] of Object.entries(extension.columns)) {
        if (targetTable.columns[columnKey]) {
          throw new Error(
            `Schema source "${source.name}" tried to add duplicate column "${columnKey}" to "${targetTableKey}".`,
          );
        }

        targetTable.columns[columnKey] = { ...columnDef };
      }

      for (const [indexKey, indexDef] of Object.entries(
        extension.indexes ?? {},
      ) as Array<[string, IndexDefinition<string>]>) {
        if (targetTable.indexes[indexKey]) {
          throw new Error(
            `Schema source "${source.name}" tried to add duplicate index "${indexKey}" to "${targetTableKey}".`,
          );
        }

        targetTable.indexes[indexKey] = {
          ...indexDef,
          columns: [...indexDef.columns],
        };
      }
    }
  }

  // Validate
  const enumDbNames = new Set<string>();
  for (const enumDef of Object.values(enums)) {
    if (enumDbNames.has(enumDef.dbName)) {
      throw new Error(`Duplicate enum database name "${enumDef.dbName}".`);
    }
    enumDbNames.add(enumDef.dbName);
  }

  const tableDbNames = new Set<string>();
  for (const table of Object.values(tables)) {
    if (tableDbNames.has(table.dbName)) {
      throw new Error(`Duplicate table database name "${table.dbName}".`);
    }
    tableDbNames.add(table.dbName);

    for (const [columnKey, columnDef] of Object.entries(table.columns)) {
      if (typeof columnDef.type === 'object') {
        const enumName = columnDef.type.enum;
        if (!enums[enumName]) {
          throw new Error(
            `Column "${table.key}.${columnKey}" references unknown enum "${enumName}".`,
          );
        }
      }

      if (columnDef.references) {
        const referencedTable = tables[columnDef.references.table];
        if (!referencedTable) {
          throw new Error(
            `Column "${table.key}.${columnKey}" references unknown table "${columnDef.references.table}".`,
          );
        }

        if (!referencedTable.columns[columnDef.references.column]) {
          throw new Error(
            `Column "${table.key}.${columnKey}" references unknown column "${columnDef.references.table}.${columnDef.references.column}".`,
          );
        }
      }
    }

    for (const [indexKey, indexDef] of Object.entries(table.indexes)) {
      for (const columnName of indexDef.columns) {
        if (!table.columns[columnName]) {
          throw new Error(
            `Index "${table.key}.${indexKey}" references unknown column "${columnName}".`,
          );
        }
      }
    }

    if (table.foreignKeys) {
      for (const fk of table.foreignKeys) {
        for (const col of fk.columns) {
          if (!table.columns[col]) {
            throw new Error(
              `Foreign key in "${table.key}" references unknown local column "${col}".`,
            );
          }
        }
        const refTable = tables[fk.foreignTable];
        if (!refTable) {
          throw new Error(
            `Foreign key in "${table.key}" references unknown table "${fk.foreignTable}".`,
          );
        }
        for (const col of fk.foreignColumns) {
          if (!refTable.columns[col]) {
            throw new Error(
              `Foreign key in "${table.key}" references unknown column "${fk.foreignTable}.${col}".`,
            );
          }
        }
      }
    }
  }

  return { enums, tables };
}

import type {
  EnumMap,
  ExtensionMap,
  SchemaModule,
  TableDefinition,
  TableMap,
  TableColumns,
} from './types';

type SchemaInput<Tables extends TableMap, Enums extends EnumMap> = {
  enums?: Enums;
  tables: Tables;
};

export function defineColumns<TColumns extends TableColumns>(
  columns: TColumns,
): TColumns {
  return columns;
}

export function defineTable<TTable extends TableDefinition>(
  table: TTable,
): TTable {
  return table;
}

export function defineCoreSchema<
  Tables extends TableMap,
  Enums extends EnumMap = {},
>(
  schema: SchemaInput<Tables, Enums>,
): SchemaModule<'cms', Tables, Enums> & { tables: Tables } {
  return { ...schema };
}

export function definePluginSchema<
  ExistingTables extends TableMap,
  _ExistingEnums extends EnumMap = {},
  Tables extends TableMap = {},
  Enums extends EnumMap = {},
  Extensions extends ExtensionMap<ExistingTables, Tables> = {},
>(schema: {
  enums?: Enums;
  tables?: Tables;
  extend?: Extensions;
}): SchemaModule<'cms', Tables, Enums, Extensions> {
  return { ...schema };
}

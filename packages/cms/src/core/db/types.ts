export type SchemaNamespace = 'cms';

export type ColumnScalarType =
  | 'text'
  | 'boolean'
  | 'integer'
  | 'timestamp'
  | 'jsonb'
  | 'tsvector';

export type ColumnType<EnumTarget extends string = string> =
  | ColumnScalarType
  | {
      enum: EnumTarget;
    };

export type DefaultValue =
  | {
      kind: 'literal';
      value: boolean | number | string | string[] | Record<string, unknown>;
    }
  | {
      kind: 'sql';
      value: string;
    };

export type ForeignKeyAction =
  | 'cascade'
  | 'restrict'
  | 'no action'
  | 'set null'
  | 'set default';

export type IndexUsing = 'btree' | 'gin';

export type ColumnDefinition<
  ReferenceTarget extends string = string,
  EnumTarget extends string = string,
> = {
  type: ColumnType<EnumTarget>;
  columnName?: string;
  notNull?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  default?: DefaultValue;
  defaultId?: boolean;
  defaultIdPrefix?: string;
  defaultNow?: boolean;
  jsonType?: string;
  references?: {
    table: ReferenceTarget;
    column: string;
    onDelete?: ForeignKeyAction;
    onUpdate?: ForeignKeyAction;
  };
};

export type TableColumns<
  ReferenceTarget extends string = string,
  EnumTarget extends string = string,
> = Record<string, ColumnDefinition<ReferenceTarget, EnumTarget>>;

export type IndexDefinition<ColumnName extends string> = {
  columns: readonly ColumnName[];
  unique?: boolean;
  using?: IndexUsing;
  where?: string;
};

export type CompositePrimaryKey<ColumnName extends string> = {
  columns: readonly ColumnName[];
};

export type TableLevelForeignKey<ColumnName extends string = string> = {
  columns: readonly ColumnName[];
  foreignTable: string;
  foreignColumns: readonly string[];
  name?: string;
  onDelete?: ForeignKeyAction;
  onUpdate?: ForeignKeyAction;
};

export type TableDefinition<Columns extends TableColumns = TableColumns> = {
  tableName?: string;
  indexPrefix?: string;
  columns: Columns;
  indexes?: Record<string, IndexDefinition<Extract<keyof Columns, string>>>;
  compositePrimaryKey?: CompositePrimaryKey<Extract<keyof Columns, string>>;
  foreignKeys?: TableLevelForeignKey<Extract<keyof Columns, string>>[];
};

export type TableExtension<
  ExistingColumns extends TableColumns,
  AddedColumns extends TableColumns,
> = {
  columns: AddedColumns;
  indexes?: Record<
    string,
    IndexDefinition<Extract<keyof ExistingColumns | keyof AddedColumns, string>>
  >;
};

export type EnumDefinition = {
  values: readonly string[];
  enumName?: string;
};

export type EnumMap = Record<string, EnumDefinition>;

export type TableMap = Record<string, TableDefinition>;

export type TableColumnsOf<TTable> =
  TTable extends TableDefinition<infer TColumns> ? TColumns : never;

export type TableName<TTables extends TableMap> = Extract<
  keyof TTables,
  string
>;

export type ColumnName<
  TTables extends TableMap,
  TTable extends TableName<TTables>,
> = Extract<keyof TableColumnsOf<TTables[TTable]>, string>;

export type EnumName<TEnums extends EnumMap> = Extract<keyof TEnums, string>;

export type ExtensionMap<
  ExistingTables extends TableMap,
  OwnTables extends TableMap = {},
> = Partial<{
  [K in keyof ExistingTables | keyof OwnTables]: TableExtension<
    TableColumnsOf<(ExistingTables & OwnTables)[K]>,
    TableColumns
  >;
}>;

export type SchemaModule<
  _Namespace extends SchemaNamespace = SchemaNamespace,
  Tables extends TableMap = {},
  Enums extends EnumMap = {},
  Extensions = {},
> = {
  enums?: Enums;
  tables?: Tables;
  extend?: Extensions;
};

export type ResolvedEnum = EnumDefinition & {
  key: string;
  dbName: string;
};

export type ResolvedTable = {
  key: string;
  dbName: string;
  indexPrefix?: string;
  columns: TableColumns;
  indexes: Record<string, IndexDefinition<string>>;
  compositePrimaryKey?: CompositePrimaryKey<string>;
  foreignKeys?: TableLevelForeignKey[];
};

export type MergedSchema = {
  enums: Record<string, ResolvedEnum>;
  tables: Record<string, ResolvedTable>;
};

export {
  defineColumns,
  defineTable,
  defineCoreSchema,
  definePluginSchema,
} from './define';

export { mergeSchemaSources, toSnakeCase, type SchemaSource } from './merge';
export { emitDrizzleSchema, type EmitOptions } from './emit';
// NOTE: generateSchema (codegen) is intentionally NOT re-exported here — it
// pulls in node:fs and must stay out of the runtime-agnostic ./db entry.
// It is consumed directly by the CLI (src/cli/commands/generate.ts).

export type {
  SchemaModule,
  ColumnScalarType,
  ColumnType,
  ColumnDefinition,
  TableColumns,
  TableDefinition,
  TableExtension,
  IndexDefinition,
  CompositePrimaryKey,
  TableLevelForeignKey,
  EnumDefinition,
  EnumMap,
  TableMap,
  ExtensionMap,
  DefaultValue,
  ForeignKeyAction,
  MergedSchema,
  ResolvedEnum,
  ResolvedTable,
} from './types';

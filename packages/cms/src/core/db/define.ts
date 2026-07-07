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

/**
 * Define a plugin schema. Curried: the FIRST call binds the core (existing)
 * tables; the SECOND call infers this schema's own `tables`/`enums`/`extend`
 * from the object literal so the column-VALUE DSL is type-checked (the `default`
 * discriminated union, column `type`, required `columns`).
 *
 * TypeScript is all-or-nothing on explicit type args, so a single-call form
 * `definePluginSchema<CoreTables>({...})` would drop `Tables`/`Enums`/
 * `Extensions` to their defaults and check the argument against `{}` (no checking
 * at all). Currying binds `ExistingTables` explicitly while still inferring the
 * rest from the argument.
 *
 * Known limitation (see db/plugin-schema.type-check.ts): `extend` KEYS are not
 * restricted to real core-table names and index `columns` names are not validated
 * — `ExtensionMap` is a `Partial<>` (excess keys pass) and added columns degrade
 * to `string`. Only the column value shapes inside `tables`/`extend` are checked.
 *
 * A plugin that only declares its OWN tables needs no type arg —
 * `definePluginSchema()({ tables: { … } })`. To type-check `extend` against the
 * core tables, bind them: `definePluginSchema<CoreTables>()({ extend: { … } })`.
 *
 * @example
 * ```ts
 * // Declare a new table (no core-table extension):
 * const schema = definePluginSchema()({
 *   tables: {
 *     pageViews: {
 *       tableName: 'page_views',
 *       columns: {
 *         // NOTE: `default` is a discriminated union, not a raw scalar.
 *         count: { type: 'integer', default: { kind: 'literal', value: 0 } },
 *       },
 *     },
 *   },
 * });
 * ```
 */
export function definePluginSchema<ExistingTables extends TableMap = {}>() {
  return function <
    Tables extends TableMap = {},
    Enums extends EnumMap = {},
    Extensions extends ExtensionMap<ExistingTables, Tables> = ExtensionMap<
      ExistingTables,
      Tables
    >,
  >(schema: {
    enums?: Enums;
    tables?: Tables;
    extend?: Extensions;
  }): SchemaModule<'cms', Tables, Enums, Extensions> {
    return { ...schema };
  };
}

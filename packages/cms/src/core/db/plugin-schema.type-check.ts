// Type-only assertions proving the currying of `definePluginSchema` (ts-02)
// makes the schema DSL actually type-checked. Checked by `check-types`
// (tsc --noEmit over src), not executed. Each `@ts-expect-error` is
// self-verifying: if the DSL check regresses, the directive goes unused and
// tsc fails.
//
// Before currying, `definePluginSchema<CoreTables>({...})` supplied ONE
// explicit type arg; TypeScript is all-or-nothing on explicit type args, so
// `Tables`/`Enums`/`Extensions` collapsed to their `{}` defaults and the
// argument was checked against `{ enums?: {}; tables?: {}; extend?: {} }` —
// i.e. NOT checked at all (every `@ts-expect-error` below would have compiled).
// Currying binds `ExistingTables` explicitly while inferring the rest from the
// object literal, so column/enum/extension shapes are now enforced.

import type { coreSchema } from './core-schema';
import type { TableMap } from './types';

import { definePluginSchema } from './define';

type CoreTables = (typeof coreSchema)['tables'] & TableMap;

// --- VALID: extend a core table with a new column + index, add an own table
//     and an enum. Compiles.
export const _valid = definePluginSchema<CoreTables>()({
  enums: { myEnum: { values: ['a', 'b'] as const } },
  tables: {
    myTable: {
      columns: {
        id: { type: 'text', primaryKey: true },
        count: { type: 'integer', default: { kind: 'literal', value: 0 } },
      },
    },
  },
  extend: {
    roots: {
      columns: { priority: { type: 'integer' } },
      // index columns include the added column + an existing core column
      indexes: { priorityIdx: { columns: ['priority', 'collection'] } },
    },
  },
});

// --- A raw scalar `default` is rejected: `DefaultValue` is a discriminated
//     union, so it must be `{ kind: 'literal', value: 0 }`. This is the headline
//     of the currying win — column definitions are now validated.
export const _rejectsRawDefault = definePluginSchema<CoreTables>()({
  extend: {
    roots: {
      columns: {
        // @ts-expect-error - `default` must be `{ kind: 'literal', value: 0 }`, not `0`
        priority: { type: 'integer', default: 0 },
      },
    },
  },
});

// --- An invalid column `type` is rejected (proves the column DSL is checked).
export const _rejectsBadColumnType = definePluginSchema<CoreTables>()({
  extend: {
    roots: {
      // @ts-expect-error - 'notacolumntype' is not a ColumnType
      columns: { priority: { type: 'notacolumntype' } },
    },
  },
});

// --- An extension entry MUST provide `columns` (the `TableExtension` shape is
//     enforced now that `Extensions` is inferred rather than `{}`).
export const _rejectsMissingColumns = definePluginSchema<CoreTables>()({
  extend: {
    // @ts-expect-error - `columns` is required on a table extension
    roots: {
      indexes: { i: { columns: ['collection'] } },
    },
  },
});

// NOTE: index-column NAMES and unknown-table KEYS on `extend` are still loose:
// `ExtensionMap` is `Partial<...>` (extra keys pass structurally) and hardcodes
// `AddedColumns = TableColumns` (so `indexes.*.columns` degrade to `string[]`).
// Tightening those would require threading the inferred added-column keys
// through `ExtensionMap`/`TableExtension` — out of scope for the currying fix.

import type {
  DefaultValue,
  MergedSchema,
  ResolvedEnum,
  ResolvedTable,
  TableLevelForeignKey,
} from './types';

import { toSnakeCase } from './merge';

function quote(value: string): string {
  return JSON.stringify(value);
}

function toPascalCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-\s]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function singularize(value: string): string {
  if (value.endsWith('ies')) {
    return `${value.slice(0, -3)}y`;
  }
  if (
    value.endsWith('ches') ||
    value.endsWith('shes') ||
    value.endsWith('xes') ||
    value.endsWith('zes')
  ) {
    return value.slice(0, -2);
  }
  if (value.endsWith('s') && !value.endsWith('ss')) {
    return value.slice(0, -1);
  }
  return value;
}

function emitLiteral(value: DefaultValue & { kind: 'literal' }): string {
  return JSON.stringify(value.value);
}

function emitDefault(defaultValue: DefaultValue): {
  code: string;
  needsSql: boolean;
} {
  switch (defaultValue.kind) {
    case 'literal':
      return {
        code: `.default(${emitLiteral(defaultValue)})`,
        needsSql: false,
      };
    case 'sql':
      return {
        code: `.default(sql.raw(${quote(defaultValue.value)}))`,
        needsSql: true,
      };
  }
}

function emitEnum(enumDef: ResolvedEnum): string {
  const values = `[${enumDef.values.map(quote).join(', ')}]`;
  return `export const ${enumDef.key}Enum = cmsSchema.enum(${quote(enumDef.dbName)}, ${values});`;
}

function emitColumn(
  table: ResolvedTable,
  columnKey: string,
  columnDef: ResolvedTable['columns'][string],
): {
  code: string;
  needsSql: boolean;
  needsAnyPgColumn: boolean;
  needsTsvector: boolean;
} {
  const columnName = columnDef.columnName ?? toSnakeCase(columnKey);

  let builder: string;
  let needsTsvector = false;
  if (typeof columnDef.type === 'string') {
    if (columnDef.type === 'tsvector') {
      builder = `tsvectorColumn(${quote(columnName)})`;
      needsTsvector = true;
    } else {
      builder = `${columnDef.type}(${quote(columnName)})`;
    }
  } else {
    builder = `${columnDef.type.enum}Enum(${quote(columnName)})`;
  }

  let needsSql = false;
  let needsAnyPgColumn = false;

  if (
    columnDef.jsonType &&
    typeof columnDef.type === 'string' &&
    columnDef.type === 'jsonb'
  ) {
    builder += `.$type<${columnDef.jsonType}>()`;
  }

  if (columnDef.primaryKey) {
    builder += '.primaryKey()';
  }

  if (columnDef.notNull) {
    builder += '.notNull()';
  }

  if (columnDef.unique) {
    builder += '.unique()';
  }

  if (columnDef.defaultNow) {
    builder += '.defaultNow()';
  }

  if (columnDef.defaultId) {
    if (!columnDef.defaultIdPrefix) {
      throw new Error(
        `Column "${columnKey}" has defaultId but no defaultIdPrefix`,
      );
    }
    builder += `.$defaultFn(() => newId(${quote(columnDef.defaultIdPrefix)}))`;
  }

  if (columnDef.default) {
    const emitted = emitDefault(columnDef.default);
    builder += emitted.code;
    needsSql ||= emitted.needsSql;
  }

  if (columnDef.references) {
    const options: string[] = [];
    if (columnDef.references.onDelete) {
      options.push(`onDelete: ${quote(columnDef.references.onDelete)}`);
    }
    if (columnDef.references.onUpdate) {
      options.push(`onUpdate: ${quote(columnDef.references.onUpdate)}`);
    }

    const suffix = options.length > 0 ? `, { ${options.join(', ')} }` : '';

    const isSelfReference = columnDef.references.table === table.key;
    const refCallback = isSelfReference
      ? `(): AnyPgColumn => ${columnDef.references.table}.${columnDef.references.column}`
      : `() => ${columnDef.references.table}.${columnDef.references.column}`;

    needsAnyPgColumn ||= isSelfReference;
    builder += `.references(${refCallback}${suffix})`;
  }

  return {
    code: `    ${columnKey}: ${builder},`,
    needsSql,
    needsAnyPgColumn,
    needsTsvector,
  };
}

function emitIndexes(table: ResolvedTable): string[] {
  const entries = Object.entries(table.indexes);
  if (entries.length === 0) {
    return [];
  }

  const prefix = table.indexPrefix ?? table.dbName;

  return entries.map(([indexKey, indexDef]) => {
    const factory = indexDef.unique ? 'uniqueIndex' : 'index';
    const columns = indexDef.columns
      .map((column) => `table.${column}`)
      .join(', ');
    let line: string;
    if (indexDef.using && indexDef.using !== 'btree') {
      line = `    ${factory}(${quote(`${prefix}_${toSnakeCase(indexKey)}`)}).using(${quote(indexDef.using)}, ${columns})`;
    } else {
      line = `    ${factory}(${quote(`${prefix}_${toSnakeCase(indexKey)}`)}).on(${columns})`;
    }
    if (indexDef.where) {
      line += `.where(sql\`${indexDef.where}\`)`;
    }
    return `${line},`;
  });
}

function emitCompositePrimaryKey(table: ResolvedTable): string | null {
  if (!table.compositePrimaryKey) return null;
  const columns = table.compositePrimaryKey.columns
    .map((col) => `table.${col}`)
    .join(', ');
  return `    primaryKey({ columns: [${columns}] }),`;
}

function emitTableLevelForeignKeys(table: ResolvedTable): {
  lines: string[];
  needsForeignKeyImport: boolean;
} {
  if (!table.foreignKeys || table.foreignKeys.length === 0) {
    return { lines: [], needsForeignKeyImport: false };
  }

  const lines = table.foreignKeys.map((fk: TableLevelForeignKey) => {
    const localCols = fk.columns.map((c) => `table.${c}`).join(', ');
    const isSelfReference = fk.foreignTable === table.key;
    const foreignCols = fk.foreignColumns
      .map((c) => `${isSelfReference ? 'table' : fk.foreignTable}.${c}`)
      .join(', ');
    const parts = [
      `      columns: [${localCols}],`,
      `      foreignColumns: [${foreignCols}],`,
    ];
    if (fk.name) {
      parts.push(`      name: ${quote(fk.name)},`);
    }
    let chain = '';
    if (fk.onDelete) {
      chain += `.onDelete(${quote(fk.onDelete)})`;
    }
    if (fk.onUpdate) {
      chain += `.onUpdate(${quote(fk.onUpdate)})`;
    }
    return `    foreignKey({\n${parts.join('\n')}\n    })${chain},`;
  });

  return { lines, needsForeignKeyImport: true };
}

function emitTableTypeAliases(table: ResolvedTable): string {
  const baseName = toPascalCase(singularize(table.key));
  return `export type ${baseName} = typeof ${table.key}.$inferSelect;
export type New${baseName} = typeof ${table.key}.$inferInsert;`;
}

function emitTable(table: ResolvedTable): {
  code: string;
  needsSql: boolean;
  needsAnyPgColumn: boolean;
  needsForeignKeyImport: boolean;
  needsPrimaryKeyImport: boolean;
  needsTsvector: boolean;
} {
  let needsSql = false;
  let needsAnyPgColumn = false;
  let needsPrimaryKeyImport = false;
  let needsTsvector = false;

  const emittedColumns = Object.entries(table.columns).map(
    ([columnKey, columnDef]) => {
      const emitted = emitColumn(table, columnKey, columnDef);
      needsSql ||= emitted.needsSql;
      needsAnyPgColumn ||= emitted.needsAnyPgColumn;
      needsTsvector ||= emitted.needsTsvector;
      return emitted.code;
    },
  );

  const indexes = emitIndexes(table);
  for (const idx of Object.values(table.indexes)) {
    if (idx.where) needsSql = true;
  }

  const compositePK = emitCompositePrimaryKey(table);
  if (compositePK) needsPrimaryKeyImport = true;

  const { lines: fkLines, needsForeignKeyImport } =
    emitTableLevelForeignKeys(table);

  const tableFactory = 'cmsSchema.table';

  const callbackLines = [
    ...(compositePK ? [compositePK] : []),
    ...fkLines,
    ...indexes,
  ];

  const callback =
    callbackLines.length > 0
      ? `,
  (table) => [
${callbackLines.join('\n')}
  ]`
      : '';

  return {
    code: `export const ${table.key} = ${tableFactory}(
  ${quote(table.dbName)},
  {
${emittedColumns.join('\n')}
  }${callback},
);`,
    needsSql,
    needsAnyPgColumn,
    needsForeignKeyImport,
    needsPrimaryKeyImport,
    needsTsvector,
  };
}

export type EmitOptions = {
  /**
   * Override the ID generation import statement.
   * Defaults to `import { newId } from '@createcms/core/nanoid';`
   */
  nanoidImport?: string;
};

export function emitDrizzleSchema(
  schema: MergedSchema,
  options?: EmitOptions,
): string {
  const pgCoreImports = new Set<string>(['pgSchema']);
  let needsSql = false;
  let needsAnyPgColumn = false;
  let needsForeignKeyImport = false;
  let needsPrimaryKeyImport = false;
  let needsTsvector = false;

  const enums = Object.values(schema.enums).sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  const tables = Object.values(schema.tables).sort((a, b) =>
    a.key.localeCompare(b.key),
  );

  for (const table of tables) {
    for (const column of Object.values(table.columns)) {
      if (typeof column.type === 'string') {
        if (column.type !== 'tsvector') {
          pgCoreImports.add(column.type);
        }
      }
      if (column.default?.kind === 'sql') {
        needsSql = true;
      }
    }
    if (Object.keys(table.indexes).length > 0) {
      pgCoreImports.add('index');
    }
    if (Object.values(table.indexes).some((indexDef) => indexDef.unique)) {
      pgCoreImports.add('uniqueIndex');
    }
    if (Object.values(table.indexes).some((indexDef) => indexDef.where)) {
      needsSql = true;
    }
  }

  const enumBlocks = enums.map(emitEnum);
  const tableBlocks = tables.map((table) => {
    const emitted = emitTable(table);
    needsSql ||= emitted.needsSql;
    needsAnyPgColumn ||= emitted.needsAnyPgColumn;
    needsForeignKeyImport ||= emitted.needsForeignKeyImport;
    needsPrimaryKeyImport ||= emitted.needsPrimaryKeyImport;
    needsTsvector ||= emitted.needsTsvector;
    return emitted.code;
  });
  const typeBlocks = tables.map(emitTableTypeAliases);

  if (needsForeignKeyImport) pgCoreImports.add('foreignKey');
  if (needsPrimaryKeyImport) pgCoreImports.add('primaryKey');
  if (needsTsvector) pgCoreImports.add('customType');

  const imports: string[] = [];
  if (needsSql) {
    imports.push(`import { sql } from 'drizzle-orm';`);
  }
  imports.push(
    `import { ${Array.from(pgCoreImports).sort().join(', ')} } from 'drizzle-orm/pg-core';`,
  );
  if (needsAnyPgColumn) {
    imports.push(`import type { AnyPgColumn } from 'drizzle-orm/pg-core';`);
  }
  const needsNewId = tables.some((table) =>
    Object.values(table.columns).some((col) => col.defaultId),
  );

  if (needsNewId) {
    imports.push(
      options?.nanoidImport ??
        `import { newId } from '@createcms/core/nanoid';`,
    );
  }

  const tsvectorDef = needsTsvector
    ? `\nconst tsvectorColumn = customType<{ data: string }>({
  dataType() { return 'tsvector'; },
});\n`
    : '';

  const schemaExport = `export const schema = {
${tables.map((table) => `  ${table.key},`).join('\n')}
${enums.map((enumDef) => `  ${enumDef.key}Enum,`).join('\n')}
};`;

  return `/* eslint-disable */
/**
 * This file is generated by createcms.
 * Do not edit manually.
 */

${imports.join('\n')}

export const cmsSchema = pgSchema('cms');
${tsvectorDef}${enumBlocks.join('\n\n')}
${enumBlocks.length > 0 && tableBlocks.length > 0 ? '\n' : ''}${tableBlocks.join('\n\n')}

${schemaExport}

${typeBlocks.join('\n\n')}
`;
}

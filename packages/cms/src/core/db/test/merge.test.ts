import { describe, expect, it } from 'vitest';

import { mergeSchemaSources, toSnakeCase, type SchemaSource } from '../merge';

// Minimal hand-built sources keep these tests independent of the real schema.
const itemsSource: SchemaSource = {
  name: 'core',
  schema: {
    enums: { status: { values: ['active', 'inactive'] } },
    tables: {
      items: {
        columns: {
          id: {
            type: 'text',
            primaryKey: true,
            defaultId: true,
            defaultIdPrefix: 'item',
          },
          status: { type: { enum: 'status' }, notNull: true },
        },
      },
    },
  },
};

describe('toSnakeCase', () => {
  it('converts camelCase / PascalCase / kebab + spaces to snake_case', () => {
    expect(toSnakeCase('blockVersions')).toBe('block_versions');
    expect(toSnakeCase('BlockVersions')).toBe('block_versions');
    expect(toSnakeCase('kebab-case name')).toBe('kebab_case_name');
    expect(toSnakeCase('already_snake')).toBe('already_snake');
  });
});

describe('mergeSchemaSources — combine + resolve', () => {
  it('merges enums + tables into keyed records with resolved db names', () => {
    const merged = mergeSchemaSources([itemsSource]);

    expect(Object.keys(merged.tables)).toEqual(['items']);
    expect(merged.tables.items.dbName).toBe('items');
    expect(merged.tables.items.key).toBe('items');
    expect(merged.enums.status.dbName).toBe('status');
    expect(merged.enums.status.values).toEqual(['active', 'inactive']);
  });

  it('computes snake_case db names + honors explicit overrides', () => {
    const merged = mergeSchemaSources([
      {
        name: 'core',
        schema: {
          enums: { postStatus: { values: ['x'], enumName: 'post_state' } },
          tables: {
            blogPosts: {
              tableName: 'articles',
              columns: { id: { type: 'text' } },
            },
          },
        },
      },
    ]);
    expect(merged.tables.blogPosts.dbName).toBe('articles'); // override
    expect(merged.enums.postStatus.dbName).toBe('post_state'); // override
  });

  it('combines two sources (core + plugin)', () => {
    const merged = mergeSchemaSources([
      itemsSource,
      {
        name: 'plugin:extra',
        schema: { tables: { widgets: { columns: { id: { type: 'text' } } } } },
      },
    ]);
    expect(Object.keys(merged.tables).sort()).toEqual(['items', 'widgets']);
  });

  it('returns empty records for no/empty sources', () => {
    expect(mergeSchemaSources([])).toEqual({ enums: {}, tables: {} });
    expect(mergeSchemaSources([{ name: 'empty', schema: {} }])).toEqual({
      enums: {},
      tables: {},
    });
  });

  it('does not mutate the input source (clones)', () => {
    const merged = mergeSchemaSources([itemsSource]);
    merged.tables.items.columns.injected = { type: 'text' };
    // re-merging the same source still yields only the original columns
    const again = mergeSchemaSources([itemsSource]);
    expect(Object.keys(again.tables.items.columns)).toEqual(['id', 'status']);
  });
});

describe('mergeSchemaSources — extensions', () => {
  it('applies a plugin extension (adds columns + indexes to an existing table)', () => {
    const merged = mergeSchemaSources([
      itemsSource,
      {
        name: 'plugin:tags',
        schema: {
          extend: {
            items: {
              columns: { tag: { type: 'text' } },
              indexes: { byTag: { columns: ['tag'] } },
            },
          },
        },
      },
    ]);
    expect(Object.keys(merged.tables.items.columns)).toContain('tag');
    expect(Object.keys(merged.tables.items.indexes)).toContain('byTag');
  });

  it('throws when extending an unknown table', () => {
    expect(() =>
      mergeSchemaSources([
        {
          name: 'p',
          schema: { extend: { nope: { columns: { x: { type: 'text' } } } } },
        },
      ]),
    ).toThrow(/extends unknown table "nope"/);
  });

  it('throws when an extension adds a duplicate column', () => {
    expect(() =>
      mergeSchemaSources([
        itemsSource,
        {
          name: 'p',
          schema: { extend: { items: { columns: { id: { type: 'text' } } } } },
        },
      ]),
    ).toThrow(/tried to add duplicate column "id"/);
  });
});

describe('mergeSchemaSources — conflict + reference validation', () => {
  it('throws on a duplicate enum / table key', () => {
    expect(() => mergeSchemaSources([itemsSource, itemsSource])).toThrow(
      /Duplicate enum "status"/,
    );
  });

  it('throws on a duplicate enum db name (distinct keys, same enumName)', () => {
    expect(() =>
      mergeSchemaSources([
        {
          name: 'p',
          schema: {
            enums: {
              a: { values: ['x'], enumName: 'shared' },
              b: { values: ['y'], enumName: 'shared' },
            },
          },
        },
      ]),
    ).toThrow(/Duplicate enum database name "shared"/);
  });

  it('throws on a duplicate table db name', () => {
    expect(() =>
      mergeSchemaSources([
        {
          name: 'p',
          schema: {
            tables: {
              a: { tableName: 'shared', columns: { id: { type: 'text' } } },
              b: { tableName: 'shared', columns: { id: { type: 'text' } } },
            },
          },
        },
      ]),
    ).toThrow(/Duplicate table database name "shared"/);
  });

  it('throws when a column references an unknown enum', () => {
    expect(() =>
      mergeSchemaSources([
        {
          name: 'p',
          schema: {
            tables: { t: { columns: { c: { type: { enum: 'ghost' } } } } },
          },
        },
      ]),
    ).toThrow(/references unknown enum "ghost"/);
  });

  it('throws when a column references an unknown table / column', () => {
    expect(() =>
      mergeSchemaSources([
        {
          name: 'p',
          schema: {
            tables: {
              t: {
                columns: {
                  ref: {
                    type: 'text',
                    references: { table: 'ghost', column: 'id' },
                  },
                },
              },
            },
          },
        },
      ]),
    ).toThrow(/references unknown table "ghost"/);

    expect(() =>
      mergeSchemaSources([
        {
          name: 'p',
          schema: {
            tables: {
              other: { columns: { id: { type: 'text' } } },
              t: {
                columns: {
                  ref: {
                    type: 'text',
                    references: { table: 'other', column: 'ghost' },
                  },
                },
              },
            },
          },
        },
      ]),
    ).toThrow(/references unknown column "other\.ghost"/);
  });

  it('throws when an index references an unknown column', () => {
    expect(() =>
      mergeSchemaSources([
        {
          name: 'p',
          schema: {
            tables: {
              t: {
                columns: { id: { type: 'text' } },
                indexes: { bad: { columns: ['ghost'] } },
              },
            },
          },
        },
      ]),
    ).toThrow(/Index "t\.bad" references unknown column "ghost"/);
  });

  it('throws on a foreign key referencing an unknown local/foreign column', () => {
    expect(() =>
      mergeSchemaSources([
        {
          name: 'p',
          schema: {
            tables: {
              t: {
                columns: { id: { type: 'text' } },
                foreignKeys: [
                  {
                    columns: ['ghost'],
                    foreignTable: 't',
                    foreignColumns: ['id'],
                  },
                ],
              },
            },
          },
        },
      ]),
    ).toThrow(/references unknown local column "ghost"/);

    // unknown FOREIGN table
    expect(() =>
      mergeSchemaSources([
        {
          name: 'p',
          schema: {
            tables: {
              t: {
                columns: { id: { type: 'text' } },
                foreignKeys: [
                  {
                    columns: ['id'],
                    foreignTable: 'ghost',
                    foreignColumns: ['id'],
                  },
                ],
              },
            },
          },
        },
      ]),
    ).toThrow(/Foreign key in "t" references unknown table "ghost"/);

    // unknown FOREIGN column
    expect(() =>
      mergeSchemaSources([
        {
          name: 'p',
          schema: {
            tables: {
              t: {
                columns: { id: { type: 'text' } },
                foreignKeys: [
                  {
                    columns: ['id'],
                    foreignTable: 't',
                    foreignColumns: ['ghost'],
                  },
                ],
              },
            },
          },
        },
      ]),
    ).toThrow(/references unknown column "t\.ghost"/);
  });
});

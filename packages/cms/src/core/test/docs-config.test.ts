import { describe, expect, it } from 'vitest';

import {
  type MdxTable,
  type TypeMember,
  codeTokens,
  diffSets,
  findTable,
  parseSourceFile,
  readDoc,
  schemaSourcePath,
  sourcePath,
  typeMembers,
} from '../../test-utils/docs';

/**
 * Pins `reference/configuration.mdx` against `CMSDefinition` and the config
 * objects it nests.
 *
 * `createCMS(definition)` is the one call every consumer makes, and its option
 * table is the page they read to make it. An option added to the type and not
 * to the table is invisible; an option removed from the type but left in the
 * table is worse: it reads as supported and does nothing. Both directions are
 * asserted, per table.
 *
 * Source of truth: the type aliases in `core/types/definitions.ts`, read via
 * the TS AST, except `BranchProtectionConfig`, which lives in the shared
 * `@createcms/schema` package's `collection.ts` and is read from there.
 * `CMSDefinition` is a plain object type with no runtime value to inspect, so
 * the AST is the only place its keys exist.
 */

const CONFIG_MDX = 'reference/configuration.mdx';

const sourceFile = parseSourceFile(sourcePath('core/types/definitions.ts'));
const schemaCollection = parseSourceFile(schemaSourcePath('collection.ts'));
const config = readDoc(CONFIG_MDX);

/**
 * One documented options table and the type it must mirror. `requiredColumn`
 * is the index of a `yes`/`no` column when the table has one; where it does,
 * the flag is checked against the type's `?`, so "Required: yes" and an
 * optional property cannot disagree. `source` defaults to `sourceFile`
 * (`core/types/definitions.ts`); set it when the type moved elsewhere (e.g.
 * `BranchProtectionConfig`, now in `@createcms/schema`).
 */
const TABLES: {
  label: string;
  type: string;
  table: { heading?: string; header: string[] };
  requiredColumn?: number;
  source?: ReturnType<typeof parseSourceFile>;
}[] = [
  {
    label: 'createCMS options',
    type: 'CMSDefinition',
    table: {
      heading: 'Options',
      header: ['Option', 'Type', 'Required', 'Default', 'Description'],
    },
    requiredColumn: 2,
  },
  {
    label: '`dataRetention`',
    type: 'DataRetentionConfig',
    table: {
      heading: '`dataRetention`',
      header: ['Field', 'Type', 'Required', 'Default', 'Description'],
    },
    requiredColumn: 2,
  },
  {
    label: '`branchProtection`',
    type: 'BranchProtectionConfig',
    table: {
      heading: '`branchProtection`',
      header: ['Field', 'Type', 'Default', 'Description'],
    },
    source: schemaCollection,
  },
  {
    label: '`user`',
    type: 'CMSUserConfig',
    table: { heading: '`user`', header: ['Field', 'Type', 'Description'] },
  },
];

/** Option name per row: the first inline-code span of the first cell. */
function documentedNames(table: MdxTable): string[] {
  return table.rows.flatMap((row) => {
    const name = codeTokens(row[0] as string)[0];
    return name === undefined ? [] : [name];
  });
}

function requiredInDocs(row: string[], column: number): boolean {
  return (row[column] ?? '').trim().toLowerCase() === 'yes';
}

describe.each(TABLES)(
  'docs coverage: $label',
  ({ label, type, table, requiredColumn, source }) => {
    // Resolved inside each test, not at import time, so a renamed type or a
    // reshaped table fails the suite that owns it with its own message
    // instead of aborting every suite in the file.
    const members = (): TypeMember[] => typeMembers(source ?? sourceFile, type);
    const documented = (): MdxTable => findTable(config, table);

    it(`documents exactly the fields \`${type}\` accepts`, () => {
      const { undocumented, stale } = diffSets(
        members().map((member) => member.name),
        documentedNames(documented()),
      );

      expect(
        undocumented,
        `${type} fields missing from the ${label} table in ${CONFIG_MDX}: ${undocumented.join(', ')}`,
      ).toEqual([]);
      expect(
        stale,
        `the ${label} table in ${CONFIG_MDX} documents fields ${type} does not have: ${stale.join(', ')}`,
      ).toEqual([]);
    });

    if (requiredColumn !== undefined) {
      it('marks the same fields required as the type does', () => {
        const optional = new Map(
          members().map((member) => [member.name, member.optional]),
        );

        const wrong = documented()
          .rows.flatMap((row) => {
            const name = codeTokens(row[0] as string)[0];
            if (name === undefined || !optional.has(name)) return [];
            const docsSaysRequired = requiredInDocs(row, requiredColumn);
            const typeSaysRequired = !optional.get(name);
            return docsSaysRequired === typeSaysRequired
              ? []
              : [
                  `${name}: documented as ${docsSaysRequired ? 'required' : 'optional'}, ` +
                    `type says ${typeSaysRequired ? 'required' : 'optional'}`,
                ];
          })
          .sort();

        expect(
          wrong,
          `wrong Required column in the ${label} table in ${CONFIG_MDX}:\n  ${wrong.join('\n  ')}`,
        ).toEqual([]);
      });
    }
  },
);

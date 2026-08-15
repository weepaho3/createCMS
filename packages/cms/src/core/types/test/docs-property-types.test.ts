import { describe, expect, it } from 'vitest';

import {
  codeTokens,
  conditionalExtras,
  diffSets,
  findTable,
  mentionsToken,
  parseSourceFile,
  readDoc,
  sourcePath,
  typeMemberNames,
} from '../../../test-utils/docs';

/**
 * Pins `reference/define.mdx` against the block-property types.
 *
 * The property model is the first thing a reader touches and the easiest to
 * outgrow silently: a new field type, a new declarative constraint, or a new
 * per-type option is a one-line change in `definitions.ts` and zero lines in
 * the docs. This test makes that omission a red test instead of a reader
 * discovering the option does not exist — or, in the other direction, chasing
 * an option the docs still advertise after it was removed.
 *
 * Source of truth: `BlockTypes`, `BlockPropertySpec`, `ListBlockPropertySpec`,
 * and `ListElementSpec` read out of `core/types/definitions.ts` via the TS AST.
 */

const DEFINE_MDX = 'reference/define.mdx';

const sourceFile = parseSourceFile(sourcePath('core/types/definitions.ts'));
const define = readDoc(DEFINE_MDX);

/** Header of the field-type table under `## Block properties`. */
const TYPE_TABLE = ['`type`', 'Value', 'Extra config'];
/** Header of the field table under the `list` section. */
const LIST_TABLE = ['Field', 'Type', 'Required', 'Description'];
const LIST_HEADING = '`list` properties';

/**
 * `list` is a property type but not a `BlockTypes` key: it is its own spec
 * (`ListBlockPropertySpec`, a sibling arm of the `BlockProperty` union) because
 * its value type comes from `of` rather than from a fixed table entry. Readers
 * do not care about that distinction, so the docs table must carry it.
 */
const LIST_TYPE = 'list';

describe('docs coverage: block property types', () => {
  it('documents exactly the property types that exist', () => {
    const scalarTypes = typeMemberNames(sourceFile, 'BlockTypes');
    const sourceTypes = [...scalarTypes, LIST_TYPE];

    const documented = findTable(define, { header: TYPE_TABLE }).rows.map(
      (row) => codeTokens(row[0] as string)[0],
    );

    const { undocumented, stale } = diffSets(
      sourceTypes,
      documented.filter((t): t is string => t !== undefined),
    );
    expect(
      undocumented,
      `property types missing from the table in ${DEFINE_MDX}: ${undocumented.join(', ')}`,
    ).toEqual([]);
    expect(
      stale,
      `${DEFINE_MDX} documents property types that no longer exist: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('documents every field of the common property shape', () => {
    const fields = typeMemberNames(sourceFile, 'BlockPropertySpec');
    const missing = fields.filter((field) => !mentionsToken(define, field));
    expect(
      missing,
      `common property fields not mentioned anywhere in ${DEFINE_MDX}: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it("documents each type's extra config in that type's table row", () => {
    const extras = conditionalExtras(sourceFile, 'BlockPropertySpec');
    const rows = new Map(
      findTable(define, { header: TYPE_TABLE }).rows.map((row) => [
        codeTokens(row[0] as string)[0],
        row[2] ?? '',
      ]),
    );

    const missing: string[] = [];
    for (const [type, keys] of extras) {
      const cell = rows.get(type);
      expect(cell, `${DEFINE_MDX} has no table row for \`${type}\``).toBeTypeOf(
        'string',
      );
      for (const key of keys) {
        if (!mentionsToken(cell as string, key)) missing.push(`${type}.${key}`);
      }
    }
    expect(
      missing.sort(),
      `extra config missing from the "Extra config" column in ${DEFINE_MDX}: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('documents exactly the fields a `list` property accepts', () => {
    const fields = typeMemberNames(sourceFile, 'ListBlockPropertySpec');
    const documented = findTable(define, {
      heading: LIST_HEADING,
      header: LIST_TABLE,
    }).rows.map((row) => codeTokens(row[0] as string)[0]);

    const { undocumented, stale } = diffSets(
      fields,
      documented.filter((f): f is string => f !== undefined),
    );
    expect(
      undocumented,
      `\`list\` fields missing from "${LIST_HEADING}" in ${DEFINE_MDX}: ${undocumented.join(', ')}`,
    ).toEqual([]);
    expect(
      stale,
      `"${LIST_HEADING}" in ${DEFINE_MDX} documents \`list\` fields that no longer exist: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('list elements carry no extra config beyond their scalar counterparts', () => {
    // The type table's "Extra config" column is checked against the SCALAR
    // specs above; a list element reusing those same keys is therefore already
    // covered. A list-ONLY option would slip through, so fail here and force
    // both a docs entry and an assertion for it.
    const scalar = conditionalExtras(sourceFile, 'BlockPropertySpec');
    const element = conditionalExtras(sourceFile, 'ListElementSpec');

    const listOnly: string[] = [];
    for (const [type, keys] of element) {
      const known = new Set(scalar.get(type) ?? []);
      for (const key of keys) {
        if (!known.has(key)) listOnly.push(`${type}.${key}`);
      }
    }
    expect(
      listOnly.sort(),
      `list elements gained options their scalar counterparts do not have: ` +
        `${listOnly.join(', ')}. Document them under "${LIST_HEADING}" in ` +
        `${DEFINE_MDX} and assert them here.`,
    ).toEqual([]);
  });
});

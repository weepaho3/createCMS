import { describe, expect, it } from 'vitest';

import {
  codeTokens,
  diffSets,
  mdxTables,
  readDoc,
} from '../../test-utils/docs';
import { CMS_ERRORS } from '../errors-data';

/**
 * Pins `reference/errors.mdx` against `CMS_ERRORS`.
 *
 * Error codes are the part of the API consumers branch on (`isCMSError(err,
 * 'PUBLICATION_APPROVAL_REQUIRED')`), so an undocumented code is a branch
 * nobody knows to write, and a code the docs still list after a rename is a
 * branch that silently never fires. `CMS_ERRORS` is dependency-free, so this
 * test reads it at RUNTIME — no AST guessing, no drift between what is parsed
 * and what ships.
 *
 * The `Message` column is deliberately NOT compared to `message`: the docs
 * expand several messages with the condition that produces them (see
 * `PROTECTED_BRANCH`), which is better documentation than the wire string.
 * Code and `status` are the contract; those are pinned.
 */

const ERRORS_MDX = 'reference/errors.mdx';
const ERROR_TABLE = ['Code', 'Status', 'Message'];

/**
 * Documented codes that are NOT in `CMS_ERRORS` because the framework, not the
 * CMS, produces them. `VALIDATION_ERROR` comes from better-call whenever a
 * request fails its zod schema; the page says so explicitly.
 */
const FRAMEWORK_CODES = new Set(['VALIDATION_ERROR']);

const errors = readDoc(ERRORS_MDX);

type DocumentedError = { code: string; status: number; heading: string };

const documented: DocumentedError[] = mdxTables(errors)
  .filter(
    (table) =>
      table.header.length === ERROR_TABLE.length &&
      ERROR_TABLE.every((cell, i) => table.header[i] === cell),
  )
  .flatMap((table) =>
    table.rows.flatMap((row) => {
      const code = codeTokens(row[0] as string)[0];
      if (code === undefined) return [];
      return [
        {
          code,
          status: Number.parseInt((row[1] ?? '').trim(), 10),
          heading: table.heading,
        },
      ];
    }),
  );

describe('docs coverage: error codes', () => {
  it('parses the error tables (guard against a vacuous pass)', () => {
    // If the page's table shape ever changes, every set below silently becomes
    // empty and every comparison passes. Fail here instead.
    expect(documented.length).toBeGreaterThan(50);
    expect(
      documented.filter((e) => !Number.isFinite(e.status)),
      'error rows whose Status column is not a number',
    ).toEqual([]);
  });

  it('documents exactly the codes that exist', () => {
    const { undocumented, stale } = diffSets(
      Object.keys(CMS_ERRORS),
      documented.map((e) => e.code),
    );
    const staleCMSCodes = stale.filter((code) => !FRAMEWORK_CODES.has(code));

    expect(
      undocumented,
      `error codes missing from ${ERRORS_MDX}: ${undocumented.join(', ')}`,
    ).toEqual([]);
    expect(
      staleCMSCodes,
      `${ERRORS_MDX} documents codes that are not in CMS_ERRORS: ${staleCMSCodes.join(', ')}`,
    ).toEqual([]);
  });

  it('documents the right HTTP status for every code', () => {
    const wrong: string[] = [];
    for (const { code, status } of documented) {
      const actual = (CMS_ERRORS as Record<string, { status: number }>)[code];
      if (!actual) continue; // reported by the coverage test above
      if (actual.status !== status) {
        wrong.push(`${code}: documented ${status}, actual ${actual.status}`);
      }
    }
    expect(
      wrong.sort(),
      `wrong HTTP status in ${ERRORS_MDX}:\n  ${wrong.join('\n  ')}`,
    ).toEqual([]);
  });

  it('lists every code exactly once', () => {
    const seen = new Map<string, string[]>();
    for (const { code, heading } of documented) {
      seen.set(code, [...(seen.get(code) ?? []), heading]);
    }
    const duplicated = [...seen]
      .filter(([, headings]) => headings.length > 1)
      .map(([code, headings]) => `${code} (under ${headings.join(', ')})`)
      .sort();
    expect(
      duplicated,
      `codes listed in more than one table in ${ERRORS_MDX}: ${duplicated.join('; ')}`,
    ).toEqual([]);
  });
});

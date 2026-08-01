import { APIError } from 'better-call';
// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { CMSClientError } from '../../client/error';
import { CMSError, getCMSErrorCode, isCMSError } from '../errors';
import { CMS_ERRORS } from '../errors-data';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Error-contract meta-test (test-17 / err-17).
 *
 * Now that the error-handling pass has landed, this locks the invariant that
 * ties the three layers together:
 *   - every core code in `CMS_ERRORS` has a real throw site,
 *   - the wire body serializes and round-trips through the client mirror, and
 *   - the `getCMSErrorCode` / `isCMSError` helpers agree for core codes,
 *     raw plugin codes (better-call `APIError`), and the client error.
 *
 * If someone adds a `CMS_ERRORS` entry but never throws it — or renames a code
 * on one side of the contract — one of these assertions breaks.
 */

/**
 * Recursively collect the contents of every `.ts` file under `src`, excluding
 * test files, ambient declarations, the test-utils harness, and any build
 * output. We concatenate rather than parse: we only need to find literal throw
 * sites via a regexp.
 */
function collectSourceText(dir: string): string {
  let text = '';
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'test-utils' || entry === 'dist') continue;
      text += collectSourceText(full);
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.endsWith('.test.ts') || entry.endsWith('.d.ts')) continue;
    text += readFileSync(full, 'utf8');
    text += '\n';
  }
  return text;
}

describe('error contract', () => {
  it('every core code in CMS_ERRORS has a literal throw site in src', () => {
    const srcRoot = path.resolve(__dirname, '../..');
    const sourceText = collectSourceText(srcRoot);

    // `new CMSError('SOME_CODE'` — a literal first argument. One dynamic throw
    // (`new CMSError(notFound)` in core/blocks/guards.ts) uses a variable and
    // is intentionally not matched, but every code it can carry
    // ('ROOT_NOT_FOUND') also has literal throws elsewhere, so all core codes
    // are covered by literals.
    const thrown = new Set<string>();
    const pattern = /new CMSError\(\s*'([A-Z0-9_]+)'/g;
    for (const match of sourceText.matchAll(pattern)) {
      thrown.add(match[1]);
    }

    const missing = Object.keys(CMS_ERRORS).filter((code) => !thrown.has(code));
    expect(missing).toEqual([]);
  });

  it('serializes structured data and round-trips through the client mirror', () => {
    const e = new CMSError('BLOCK_NOT_FOUND', { data: { blockId: 'x' } });

    expect(e.status).toBe(404);
    expect(e.body?.code).toBe('BLOCK_NOT_FOUND');
    expect(e.body?.data.blockId).toBe('x');
    expect(e.cmsCode).toBe('BLOCK_NOT_FOUND');

    // The browser client rebuilds a plain-Error mirror from the wire body.
    const client = new CMSClientError({
      // better-call types `.status` as a string|number union; at runtime a
      // CMSError always carries the numeric `def.status`.
      status: e.status as number,
      message: e.body?.message,
      code: e.body?.code,
      data: e.body?.data,
    });
    expect(client.cmsCode).toBe('BLOCK_NOT_FOUND');
    expect(client.data?.blockId).toBe('x');
  });

  it('helpers resolve a core code', () => {
    const e = new CMSError('BLOCK_NOT_FOUND');

    expect(getCMSErrorCode(e)).toBe('BLOCK_NOT_FOUND');
    expect(isCMSError(e)).toBe(true);
    expect(isCMSError(e, 'BLOCK_NOT_FOUND')).toBe(true);
  });

  it('helpers resolve a raw plugin code from a better-call APIError', () => {
    const e = new APIError(404, {
      code: 'AB_TEST_NOT_FOUND',
      message: 'A/B test not found',
    });

    // Not a core code, so the raw-string branch surfaces it verbatim.
    expect(getCMSErrorCode(e)).toBe('AB_TEST_NOT_FOUND');
    expect(isCMSError(e)).toBe(true);
    expect(isCMSError(e, 'AB_TEST_NOT_FOUND' as never)).toBe(true);

    const client = new CMSClientError({ code: 'AB_TEST_NOT_FOUND' });
    expect(client.cmsCode).toBe('AB_TEST_NOT_FOUND');
  });

  it('helpers reject non-CMS errors and mismatched codes', () => {
    expect(getCMSErrorCode(new Error())).toBeUndefined();
    expect(isCMSError(new Error())).toBe(false);

    const coreErr = new CMSError('BLOCK_NOT_FOUND');
    expect(isCMSError(coreErr, 'WRONG_CODE' as never)).toBe(false);
  });
});

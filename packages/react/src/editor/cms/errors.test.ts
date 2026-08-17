import { describe, expect, it } from 'vitest';

import {
  BLOCK_NOT_ALLOWED_IN_PARENT,
  COMMIT_MESSAGE_REQUIRED,
  HEAD_MISMATCH,
  PROTECTED_BRANCH,
  readCmsError,
  TYPE_MISMATCH,
} from './errors';

describe('readCmsError', () => {
  it('reads a CMSClientError-shaped object', () => {
    expect(
      readCmsError({
        code: HEAD_MISMATCH,
        message: 'The branch has advanced',
        data: { reason: 'stale' },
      }),
    ).toEqual({
      code: HEAD_MISMATCH,
      message: 'The branch has advanced',
    });
  });

  it('reads nested body fields', () => {
    expect(
      readCmsError({
        body: {
          code: PROTECTED_BRANCH,
          message: 'Branch is protected',
          data: { branchId: 'br_1' },
        },
      }),
    ).toEqual({
      code: PROTECTED_BRANCH,
      message: 'Branch is protected',
    });
  });

  it('maps TYPE_MISMATCH issues to fields', () => {
    expect(
      readCmsError({
        code: TYPE_MISMATCH,
        message: 'Type mismatch',
        data: {
          blockId: 'b1',
          issues: [
            { path: ['headline'], message: 'Required' },
            { path: ['level'], message: 'Expected number' },
          ],
        },
      }),
    ).toEqual({
      code: TYPE_MISMATCH,
      message: 'Type mismatch',
      fields: [
        { blockId: 'b1', key: 'headline', message: 'Required' },
        { blockId: 'b1', key: 'level', message: 'Expected number' },
      ],
    });
  });

  it('omits fields when TYPE_MISMATCH has no issues', () => {
    const result = readCmsError({
      code: TYPE_MISMATCH,
      message: 'Type mismatch',
      data: { blockId: 'b1' },
    });
    expect(result.fields).toBeUndefined();
  });

  it('returns UNKNOWN for an unknown object', () => {
    expect(readCmsError({})).toEqual({
      code: 'UNKNOWN',
      message: 'Unknown CMS error',
    });
  });

  it('passes through BLOCK_NOT_ALLOWED_IN_PARENT', () => {
    expect(
      readCmsError({
        code: BLOCK_NOT_ALLOWED_IN_PARENT,
        message: 'Not allowed',
      }).code,
    ).toBe(BLOCK_NOT_ALLOWED_IN_PARENT);
  });

  it('passes through COMMIT_MESSAGE_REQUIRED', () => {
    expect(
      readCmsError({
        code: COMMIT_MESSAGE_REQUIRED,
        message: 'Message required',
      }).code,
    ).toBe(COMMIT_MESSAGE_REQUIRED);
  });
});

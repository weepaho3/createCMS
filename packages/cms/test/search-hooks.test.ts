import { beforeEach, describe, expect, it, vi } from 'vitest';

// The create-after-hooks read the mutation RESULT to find the id to index. When
// ret-08/ret-12 wrapped createMergeRequest/createCommentMessage returns in an
// entity envelope, the hooks had to follow (result.mergeRequest.id /
// result.message.id) — reading the old flat key silently indexed nothing. The
// existing search tests use reindexSearch (which re-indexes everything), so they
// never exercised these hooks; this file locks the extraction deterministically.
vi.mock('../src/core/search/index-builder', () => ({
  indexRoot: vi.fn().mockResolvedValue(undefined),
  indexMergeRequest: vi.fn().mockResolvedValue(undefined),
  indexComment: vi.fn().mockResolvedValue(undefined),
  indexAsset: vi.fn().mockResolvedValue(undefined),
  indexTemplate: vi.fn().mockResolvedValue(undefined),
  indexVariable: vi.fn().mockResolvedValue(undefined),
  deleteSearchIndex: vi.fn().mockResolvedValue(undefined),
}));

import {
  indexComment,
  indexMergeRequest,
} from '../src/core/search/index-builder';
import { createSearchHooks } from '../src/core/search/hooks';

const hooks = createSearchHooks('main');
const hookFor = (action: string) => hooks.find((h) => h.action === action)!;
const db = {} as never;

async function fire(action: string, input: unknown, result: unknown) {
  await hookFor(action).handler({ db, input, result } as never);
}

describe('search after-hooks extract ids from the wrapped return shapes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createMergeRequest indexes result.mergeRequest.id (ret-08 envelope)', async () => {
    await fire(
      'createMergeRequest',
      {},
      { mergeRequest: { id: 'mr_1' }, hasConflicts: false, conflicts: [] },
    );
    expect(indexMergeRequest).toHaveBeenCalledWith(db, 'mr_1');
  });

  it('createCommentMessage indexes result.message.id (ret-12 envelope)', async () => {
    await fire('createCommentMessage', {}, { message: { id: 'msg_1' } });
    expect(indexComment).toHaveBeenCalledWith(db, 'msg_1');
  });

  // Regression guards: the OLD flat keys must NOT index (they are now undefined).
  it('does not index when the pre-envelope flat key is present', async () => {
    await fire('createMergeRequest', {}, { mergeRequestId: 'mr_old' });
    await fire('createCommentMessage', {}, { id: 'msg_old' });
    expect(indexMergeRequest).not.toHaveBeenCalled();
    expect(indexComment).not.toHaveBeenCalled();
  });
});

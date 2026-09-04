import { beforeEach, describe, expect, it, vi } from 'vitest';

// The create-after-hooks read the mutation RESULT to find the id to index. When
// createMergeRequest/createCommentMessage return their entity in an
// entity envelope, the hooks had to follow (result.mergeRequest.id /
// result.message.id) — reading the old flat key silently indexed nothing. The
// existing search tests use reindexSearch (which re-indexes everything), so they
// never exercised these hooks; this file locks the extraction deterministically.
vi.mock('../index-builder', () => ({
  indexRoot: vi.fn().mockResolvedValue(undefined),
  indexMergeRequest: vi.fn().mockResolvedValue(undefined),
  indexComment: vi.fn().mockResolvedValue(undefined),
  indexAsset: vi.fn().mockResolvedValue(undefined),
  indexTemplate: vi.fn().mockResolvedValue(undefined),
  indexVariable: vi.fn().mockResolvedValue(undefined),
  deleteSearchIndex: vi.fn().mockResolvedValue(undefined),
}));

import { createSearchHooks } from '../hooks';
import { indexComment, indexMergeRequest, indexRoot } from '../index-builder';

const hooks = createSearchHooks('main');
const hookFor = (action: string) => hooks.find((h) => h.action === action)!;
const db = {} as never;

async function fire(action: string, input: unknown, result: unknown) {
  await hookFor(action).handler({ db, input, result } as never);
}

describe('search after-hooks extract ids from the wrapped return shapes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('createMergeRequest indexes result.mergeRequest.id (envelope)', async () => {
    await fire(
      'createMergeRequest',
      {},
      { mergeRequest: { id: 'mr_1' }, hasConflicts: false, conflicts: [] },
    );
    expect(indexMergeRequest).toHaveBeenCalledWith(db, 'mr_1');
  });

  it('createCommentMessage indexes result.message.id (envelope)', async () => {
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

describe('search after-hooks cover merge, publish, duplicateRoot, revertBranch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('executeMerge indexes result.rootId', async () => {
    await fire(
      'executeMerge',
      { mergeRequestId: 'mr_1' },
      { rootId: 'root_1', targetBranchId: 'b_1' },
    );
    expect(indexRoot).toHaveBeenCalledWith(db, 'root_1', 'main');
  });

  it('executeMerge does not index when the result has no rootId', async () => {
    await fire(
      'executeMerge',
      { rootId: 'root_x', mergeRequestId: 'mr_1' },
      {},
    );
    expect(indexRoot).not.toHaveBeenCalled();
  });

  it('publishBranch indexes input.rootId', async () => {
    await fire('publishBranch', { rootId: 'root_1', branchId: 'b_1' }, {});
    expect(indexRoot).toHaveBeenCalledWith(db, 'root_1', 'main');
  });

  it('duplicateRoot indexes result.rootId', async () => {
    await fire(
      'duplicateRoot',
      {},
      { mode: 'root', rootId: 'root_new', branchId: 'b', commit: { id: 'c' } },
    );
    expect(indexRoot).toHaveBeenCalledWith(db, 'root_new', 'main');
  });

  it('revertBranch indexes result.rootId', async () => {
    await fire(
      'revertBranch',
      { branchId: 'b_1', targetCommitId: 'c_1' },
      { rootId: 'root_1', commit: { id: 'c' } },
    );
    expect(indexRoot).toHaveBeenCalledWith(db, 'root_1', 'main');
  });
});

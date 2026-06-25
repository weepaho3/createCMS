import { describe, expect, it } from 'vitest';

import { setupTestCMS } from './utils/cms';

type HistoryItem = { id: string; message: string; branch: string };

async function historyByMessage(
  cms: Awaited<ReturnType<typeof setupTestCMS>>['cms'],
  rootId: string,
): Promise<Map<string, string>> {
  const hist = await cms.api.pages.getRootHistory({ query: { rootId } });
  return new Map(
    (hist.data as unknown as HistoryItem[]).map((d) => [d.message, d.branch]),
  );
}

describe('getRootHistory — branch attribution is stored, not heuristic', () => {
  it('attributes shared ancestors to their creation branch, not the nearest tip', async () => {
    const { cms } = await setupTestCMS();

    // main:  init ── main-c1 ──────────── main-m1
    //                   └── feat: feat-f1            (feat forks at main-c1)
    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'x' }, message: 'init' },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'a' },
        message: 'main-c1',
      },
    });
    const feat = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feat',
        sourceBranchId: root.branchId,
      },
    });
    // feat has FEWER post-fork commits than main → the old MIN(depth) heuristic
    // would mis-label the shared ancestors (init, main-c1) as 'feat'.
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: feat.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'f' },
        message: 'feat-f1',
      },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'b' },
        message: 'main-m1',
      },
    });

    const branchOf = await historyByMessage(cms, root.rootId);
    expect(branchOf.get('init')).toBe('main'); // shared ancestor
    expect(branchOf.get('main-c1')).toBe('main'); // shared ancestor (fork point)
    expect(branchOf.get('main-m1')).toBe('main');
    expect(branchOf.get('feat-f1')).toBe('feat'); // feature-exclusive
  });

  it('follows a branch rename (live join)', async () => {
    const { cms } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'x' } },
    });
    const feat = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feat',
        sourceBranchId: root.branchId,
      },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: feat.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'f' },
        message: 'feat-commit',
      },
    });

    await cms.api.pages.renameBranch({
      body: { branchId: feat.branchId, newName: 'feat-renamed' },
    });

    const branchOf = await historyByMessage(cms, root.rootId);
    expect(branchOf.get('feat-commit')).toBe('feat-renamed');
  });

  it('survives a branch deletion (name snapshot fallback)', async () => {
    const { cms } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'x' } },
    });
    const feat = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'feat-del',
        sourceBranchId: root.branchId,
      },
    });
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: feat.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'f' },
        message: 'feat-commit',
      },
    });

    await cms.api.pages.deleteBranch({ body: { branchId: feat.branchId } });

    // The branch row is gone (live join misses) → falls back to the snapshot.
    const branchOf = await historyByMessage(cms, root.rootId);
    expect(branchOf.get('feat-commit')).toBe('feat-del');
  });
});

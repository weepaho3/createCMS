import { describe, expect, it } from 'vitest';

import { setupTestCMS } from '../../test-utils/cms';

describe('forceCommitMessage', () => {
  it('rejects a root mutation with no message', async () => {
    const { cms } = await setupTestCMS({ forceCommitMessage: true });
    await expect(
      cms.api.pages.createRoot({
        body: { slug: '/', properties: { title: 'Home' } },
      }),
    ).rejects.toThrow(/commit message is required/i);
  });

  it('rejects a whitespace-only message', async () => {
    const { cms } = await setupTestCMS({ forceCommitMessage: true });
    await expect(
      cms.api.pages.createRoot({
        body: { slug: '/', properties: { title: 'Home' }, message: '   ' },
      }),
    ).rejects.toThrow(/commit message is required/i);
  });

  it('accepts a non-empty message, and enforces it on block mutations too', async () => {
    const { cms } = await setupTestCMS({ forceCommitMessage: true });

    const root = await cms.api.pages.createRoot({
      body: {
        slug: '/',
        properties: { title: 'Home' },
        message: 'Create home',
      },
    });
    expect(root.rootId).toBeTruthy();

    // createBlock without a message is rejected...
    await expect(
      cms.api.pages.createBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          parentBlockId: root.rootId,
          type: 'paragraph',
          properties: { text: 'Hi' },
        },
      }),
    ).rejects.toThrow(/commit message is required/i);

    // ...and accepted with one.
    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Hi' },
        message: 'Add intro',
      },
    });
    expect(block.blockId).toBeTruthy();
  });

  it('is off by default — a missing message falls back to an auto-generated one', async () => {
    const { cms } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });
    expect(root.rootId).toBeTruthy();
  });
});

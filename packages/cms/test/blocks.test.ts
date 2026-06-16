import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createCMS } from '../src/index';
import {
  blockVersions,
  branches,
  commitSnapshots,
  commits,
  roots,
} from '../src/schema';
import { setupTestCMS } from './utils/cms';
import { setupTestDB } from './utils/db';
import { publishApprovedBranch } from './utils/helpers';

describe('createRoot', () => {
  it('creates root, commit, branch, block version, and snapshot via the handler', async () => {
    const { cms, db } = await setupTestCMS();

    const result = await cms.api.pages.createRoot({
      body: {
        message: 'Create home page',
        slug: '/',
        properties: { title: 'Home' },
      },
    });

    const [root] = await db
      .select()
      .from(roots)
      .where(eq(roots.id, result.rootId));
    expect(root.collection).toBe('pages');

    const [commit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, result.commitId));
    expect(commit.rootId).toBe(result.rootId);
    expect(commit.parentCommitId).toBeNull();
    expect(commit.message).toBe('Create home page');

    // "main" branch points at the initial commit
    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, result.branchId));
    expect(branch.name).toBe('main');
    expect(branch.rootId).toBe(result.rootId);
    expect(branch.headCommitId).toBe(result.commitId);

    // Root block version stores the input properties
    const [bv] = await db
      .select()
      .from(blockVersions)
      .where(eq(blockVersions.commitId, result.commitId));
    expect(bv.blockId).toBe(result.rootId);
    expect(bv.rootId).toBe(result.rootId);
    expect(bv.type).toBe('pages');
    expect(bv.properties).toEqual({ title: 'Home' });
    expect(bv.children).toEqual([]);

    // Commit snapshot exists for O(1) lookups
    const [snap] = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, result.commitId));
    expect(snap.blockId).toBe(result.rootId);
    expect(snap.blockVersionId).toBe(bv.id);
  });
});

describe('listRoots', () => {
  it('returns all roots for a tenant with their properties', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });

    await cms.api.pages.createRoot({
      body: { slug: '/about', properties: { title: 'About' } },
    });

    const result = await cms.api.pages.listRoots();

    expect(result.roots).toHaveLength(2);

    const titles = result.roots.map((r) => (r.properties as any).title).sort();
    expect(titles).toEqual(['About', 'Home']);
  });

  it('all roots share the default tenant when no plugin is active', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.pages.createRoot({
      body: { slug: '/a', properties: { title: 'Page A' } },
    });

    await cms.api.pages.createRoot({
      body: { slug: '/b', properties: { title: 'Page B' } },
    });

    const result = await cms.api.pages.listRoots();

    expect(result.roots).toHaveLength(2);
    const titles = result.roots.map((r) => (r.properties as any).title).sort();
    expect(titles).toEqual(['Page A', 'Page B']);
  });

  it('returns paginated results with total and hasMore', async () => {
    const { cms } = await setupTestCMS();

    // Create 3 roots
    for (let i = 1; i <= 3; i++) {
      await cms.api.pages.createRoot({
        body: { slug: `/page-${i}`, properties: { title: `Page ${i}` } },
      });
    }

    const result = await cms.api.pages.listRoots({
      query: { limit: 2, offset: 0 },
    });

    expect(result.roots).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.hasMore).toBe(true);
  });

  it('filters by search term on title', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home Page' } },
    });

    await cms.api.pages.createRoot({
      body: { slug: '/about', properties: { title: 'About Us' } },
    });

    const result = await cms.api.pages.listRoots({
      query: { search: 'Home', searchField: 'title' },
    });

    expect(result.roots).toHaveLength(1);
    expect((result.roots[0].properties as any).title).toBe('Home Page');
  });

  it('filters by root properties using exact subset matching', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.pages.createRoot({
      body: {
        slug: '/',
        properties: { title: 'Home Page', description: 'featured' },
      },
    });

    await cms.api.pages.createRoot({
      body: {
        slug: '/about',
        properties: { title: 'About Us', description: 'plain' },
      },
    });

    const bySlug = await cms.api.pages.listRoots({
      query: { filterField: 'slug', filterValue: 'about' },
    });

    expect(bySlug.roots).toHaveLength(1);
    expect((bySlug.roots[0].properties as any).title).toBe('About Us');

    const byDescription = await cms.api.pages.listRoots({
      query: { filterField: 'description', filterValue: 'featured' },
    });

    expect(byDescription.roots).toHaveLength(1);
    expect((byDescription.roots[0].properties as any).title).toBe('Home Page');
  });

  it('includes publication information for roots', async () => {
    const { cms } = await setupTestCMS();

    const root1 = await cms.api.pages.createRoot({
      body: { slug: '/published', properties: { title: 'Published Page' } },
    });

    const root2 = await cms.api.pages.createRoot({
      body: { slug: '/unpublished', properties: { title: 'Unpublished Page' } },
    });

    // Publish only root1
    await publishApprovedBranch(cms, {
      rootId: root1.rootId,
      branchId: root1.branchId,
      publishedBy: 'user-1',
    });

    const result = await cms.api.pages.listRoots();

    const published = result.roots.find((r) => r.rootId === root1.rootId);
    const unpublished = result.roots.find((r) => r.rootId === root2.rootId);

    expect(published!.hasPublications).toBe(true);
    expect(published!.publicationCount).toBe(1);
    expect(unpublished!.hasPublications).toBe(false);
    expect(unpublished!.publicationCount).toBe(0);
  });

  it('filters by hasPublications', async () => {
    const { cms } = await setupTestCMS();

    const root1 = await cms.api.pages.createRoot({
      body: { slug: '/pub', properties: { title: 'Published' } },
    });

    await cms.api.pages.createRoot({
      body: { slug: '/unpub', properties: { title: 'Unpublished' } },
    });

    await publishApprovedBranch(cms, {
      rootId: root1.rootId,
      branchId: root1.branchId,
      publishedBy: 'user-1',
    });

    const result = await cms.api.pages.listRoots({
      query: { hasPublications: true },
    });

    expect(result.roots).toHaveLength(1);
    expect(result.roots[0].hasPublications).toBe(true);
  });

  it('applies hasPublications before count and pagination', async () => {
    const { cms } = await setupTestCMS();

    const publishedA = await cms.api.pages.createRoot({
      body: { slug: '/pub-a', properties: { title: 'Published A' } },
    });
    const publishedB = await cms.api.pages.createRoot({
      body: { slug: '/pub-b', properties: { title: 'Published B' } },
    });
    await cms.api.pages.createRoot({
      body: { slug: '/unpub', properties: { title: 'Unpublished' } },
    });

    await publishApprovedBranch(cms, {
      rootId: publishedA.rootId,
      branchId: publishedA.branchId,
      publishedBy: 'user-1',
    });
    await publishApprovedBranch(cms, {
      rootId: publishedB.rootId,
      branchId: publishedB.branchId,
      publishedBy: 'user-2',
    });

    const page1 = await cms.api.pages.listRoots({
      query: { hasPublications: true, limit: 1, offset: 0 },
    });
    const page2 = await cms.api.pages.listRoots({
      query: { hasPublications: true, limit: 1, offset: 1 },
    });

    expect(page1.roots).toHaveLength(1);
    expect(page1.total).toBe(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.roots[0].hasPublications).toBe(true);

    expect(page2.roots).toHaveLength(1);
    expect(page2.total).toBe(2);
    expect(page2.hasMore).toBe(false);
    expect(page2.roots[0].hasPublications).toBe(true);
  });
});

describe('createBlock', () => {
  it('adds a child block, creates a new commit, and advances the branch head', async () => {
    const { cms, db } = await setupTestCMS();
    // Set up a root to attach a child to
    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });

    const child = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        message: 'Add intro paragraph',
        type: 'paragraph',
        properties: { text: 'Hello world' },
      },
    });

    // New commit is a child of the initial commit
    const [newCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, child.commitId));
    expect(newCommit.parentCommitId).toBe(root.commitId);
    expect(newCommit.rootId).toBe(root.rootId);
    expect(newCommit.message).toBe('Add intro paragraph');

    // Child block version has correct type, properties, and parent reference
    const [childBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, child.commitId),
          eq(blockVersions.blockId, child.blockId),
        ),
      );
    expect(childBv.type).toBe('paragraph');
    expect(childBv.properties).toEqual({ text: 'Hello world' });
    expect(childBv.children).toEqual([]);

    // Parent block version was updated with the child in children[]
    const [parentBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, child.commitId),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(parentBv.children).toEqual([child.blockId]);

    // Snapshot contains both root block and child block
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, child.commitId));
    const snapBlockIds = snapRows.map((s) => s.blockId).sort();
    expect(snapBlockIds).toEqual([root.rootId, child.blockId].sort());

    // Branch head advanced to the new commit
    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, root.branchId));
    expect(branch.headCommitId).toBe(child.commitId);
  });

  it('appends multiple children in order', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const first = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'First' },
      },
    });

    const second = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: '/img.png' },
      },
    });

    // Parent's children[] preserves insertion order
    const [parentBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, second.commitId),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(parentBv.children).toEqual([first.blockId, second.blockId]);

    // Snapshot at latest commit has all three blocks (root + 2 children)
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, second.commitId));
    expect(snapRows).toHaveLength(3);
    const snapBlockIds = snapRows.map((s) => s.blockId).sort();
    expect(snapBlockIds).toEqual(
      [root.rootId, first.blockId, second.blockId].sort(),
    );

    // Commit chain: initial → first → second
    const [secondCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, second.commitId));
    expect(secondCommit.parentCommitId).toBe(first.commitId);
  });

  it('inserts block at specified position in children array', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    // Create initial blocks: A, B (order will be [A, B])
    const a = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    const b = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'B' },
      },
    });

    // Insert at position 0: should become first element -> [X, A, B]
    const x = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        position: 0,
        type: 'paragraph',
        properties: { text: 'X at pos 0' },
      },
    });

    // Insert at position 2 (between A and B): -> [X, A, Y, B]
    const y = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        position: 2,
        type: 'paragraph',
        properties: { text: 'Y at pos 2' },
      },
    });

    // Verify the final order is [X, A, Y, B]
    const [parentBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, y.commitId),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(parentBv.children).toEqual([
      x.blockId,
      a.blockId,
      y.blockId,
      b.blockId,
    ]);
  });

  it('rejects creating a child under a deleted parent', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/deleted-parent', properties: { title: 'Page' } },
    });

    const parent = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Parent' },
      },
    });

    await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: parent.blockId,
      },
    });

    await expect(
      cms.api.pages.createBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          parentBlockId: parent.blockId,
          type: 'paragraph',
          properties: { text: 'Should fail' },
        },
      }),
    ).rejects.toThrow(/Block is already deleted/);
  });
});

describe('getBlockTree', () => {
  it('returns a nested tree with children in correct order', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const first = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'First paragraph' },
      },
    });

    const second = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: '/hero.png' },
      },
    });

    const result = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });

    expect(result.reconstructed).toBe(false);
    const tree = result.tree;
    expect(tree.blockId).toBe(root.rootId);
    expect(tree.properties).toEqual({ title: 'Page' });
    expect(tree.children).toHaveLength(2);

    expect(tree.children[0].blockId).toBe(first.blockId);
    expect(tree.children[0].type).toBe('paragraph');
    expect(tree.children[0].properties).toEqual({ text: 'First paragraph' });
    expect(tree.children[0].children).toEqual([]);

    expect(tree.children[1].blockId).toBe(second.blockId);
    expect(tree.children[1].type).toBe('image');
    expect(tree.children[1].properties).toEqual({ src: '/hero.png' });
    expect(tree.children[1].children).toEqual([]);
  });

  it('returns the tree at an older commit when commitId is provided', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    // After createRoot we have one commit with no children
    const initialCommitId = root.commitId;

    // Add a child block — this produces a second commit
    const child = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Added later' },
      },
    });

    // Current branch head should include the child
    const latest = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });
    expect(latest.reconstructed).toBe(false);
    expect(latest.tree.children).toHaveLength(1);
    expect(latest.tree.children[0].blockId).toBe(child.blockId);

    // Requesting the initial commit should show no children
    const old = await cms.api.pages.getBlockTree({
      query: {
        rootId: root.rootId,
        branchId: root.branchId,
        commitId: initialCommitId,
      },
    });
    expect(old.tree.blockId).toBe(root.rootId);
    expect(old.tree.properties).toEqual({ title: 'Page' });
    expect(old.tree.children).toHaveLength(0);
  });
  it('reconstructs the tree when snapshots have been pruned for an intermediate commit', async () => {
    const { cms, db } = await setupTestCMS();

    // C1: createRoot (root block only)
    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    // C2: add a paragraph child
    const para = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Hello' },
      },
    });

    const c2CommitId = para.commitId;

    // C3: add an image child
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: '/img.png' },
      },
    });

    // Prune snapshots for C2 (simulating snapshot pruning)
    await db
      .delete(commitSnapshots)
      .where(eq(commitSnapshots.commitId, c2CommitId));

    // getBlockTree at C2 should reconstruct from C1's snapshot + C2's block_versions
    const result = await cms.api.pages.getBlockTree({
      query: {
        rootId: root.rootId,
        branchId: root.branchId,
        commitId: c2CommitId,
      },
    });

    expect(result.reconstructed).toBe(true);
    expect(result.tree.blockId).toBe(root.rootId);
    expect(result.tree.children).toHaveLength(1);
    expect(result.tree.children[0].blockId).toBe(para.blockId);
    expect(result.tree.children[0].type).toBe('paragraph');
    expect(result.tree.children[0].properties).toEqual({ text: 'Hello' });
  });

  it('reconstructs the tree when all snapshots have been pruned', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const para = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Content' },
      },
    });

    // Delete ALL snapshots for this root's commits
    const allCommits = await db
      .select({ id: commits.id })
      .from(commits)
      .where(eq(commits.rootId, root.rootId));

    for (const c of allCommits) {
      await db
        .delete(commitSnapshots)
        .where(eq(commitSnapshots.commitId, c.id));
    }

    // getBlockTree should still work via full reconstruction
    const result = await cms.api.pages.getBlockTree({
      query: {
        rootId: root.rootId,
        branchId: root.branchId,
        commitId: para.commitId,
      },
    });

    expect(result.reconstructed).toBe(true);
    expect(result.tree.blockId).toBe(root.rootId);
    expect(result.tree.children).toHaveLength(1);
    expect(result.tree.children[0].blockId).toBe(para.blockId);
    expect(result.tree.children[0].properties).toEqual({ text: 'Content' });
  });
});

describe('moveBlock', () => {
  it('reorders children within the same parent', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const a = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    const b = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'B' },
      },
    });

    const c = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'C' },
      },
    });

    // Move C to index 0: [A, B, C] → [C, A, B]
    const move = await cms.api.pages.moveBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: c.blockId,
        newParentBlockId: root.rootId,
        newIndex: 0,
        message: 'Move C to the front',
      },
    });

    // Parent children[] is now [C, A, B]
    const [parentBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, move.commitId),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(parentBv.children).toEqual([c.blockId, a.blockId, b.blockId]);

    const [moveCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, move.commitId));
    expect(moveCommit.message).toBe('Move C to the front');

    // Snapshot still has all 4 blocks (root + A + B + C)
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, move.commitId));
    expect(snapRows).toHaveLength(4);
    const snapBlockIds = snapRows.map((s) => s.blockId).sort();
    expect(snapBlockIds).toEqual(
      [root.rootId, a.blockId, b.blockId, c.blockId].sort(),
    );
  });

  it('reparents a block to a different parent', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const containerA = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Container A' },
      },
    });

    const blockB = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: '/b.png' },
      },
    });

    // Move B from root into containerA at index 0
    const move = await cms.api.pages.moveBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: blockB.blockId,
        newParentBlockId: containerA.blockId,
        newIndex: 0,
      },
    });

    // Old parent (root) no longer has B in children[]
    const [rootBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, move.commitId),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(rootBv.children).toEqual([containerA.blockId]);

    // New parent (containerA) now has B in children[]
    const [containerBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, move.commitId),
          eq(blockVersions.blockId, containerA.blockId),
        ),
      );
    expect(containerBv.children).toEqual([blockB.blockId]);

    // Snapshot has all 3 blocks
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, move.commitId));
    expect(snapRows).toHaveLength(3);
    const snapBlockIds = snapRows.map((s) => s.blockId).sort();
    expect(snapBlockIds).toEqual(
      [root.rootId, containerA.blockId, blockB.blockId].sort(),
    );
  });

  it('rejects moving a block into its own descendant', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const parent = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Parent' },
      },
    });

    const child = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: parent.blockId,
        type: 'paragraph',
        properties: { text: 'Child' },
      },
    });

    // Moving parent into its own child must fail
    await expect(
      cms.api.pages.moveBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: parent.blockId,
          newParentBlockId: child.blockId,
          newIndex: 0,
        },
      }),
    ).rejects.toThrow(/Cannot move an item into its own descendant/);
  });

  it('rejects moving a deleted block', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/move-deleted-block', properties: { title: 'Page' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'To delete' },
      },
    });

    await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: block.blockId,
      },
    });

    await expect(
      cms.api.pages.moveBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: block.blockId,
          newParentBlockId: root.rootId,
          newIndex: 0,
        },
      }),
    ).rejects.toThrow(/Block is already deleted/);
  });

  it('rejects moving a block into a deleted parent', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/move-deleted-parent', properties: { title: 'Page' } },
    });

    const source = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Source' },
      },
    });

    const deletedParent = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Deleted parent' },
      },
    });

    await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: deletedParent.blockId,
      },
    });

    await expect(
      cms.api.pages.moveBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: source.blockId,
          newParentBlockId: deletedParent.blockId,
          newIndex: 0,
        },
      }),
    ).rejects.toThrow(/Block is already deleted/);
  });
});

describe('deleteBlock', () => {
  it('soft-deletes a leaf block, marks it deleted, removes from parent children[], advances head', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const para = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'To be deleted' },
      },
    });

    const del = await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: para.blockId,
        message: 'Remove old paragraph',
      },
    });

    // New commit is a child of the previous commit
    const [newCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, del.commitId));
    expect(newCommit.parentCommitId).toBe(para.commitId);
    expect(newCommit.rootId).toBe(root.rootId);
    expect(newCommit.message).toBe('Remove old paragraph');

    // Parent's children[] no longer contains the deleted block
    const [parentBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, del.commitId),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(parentBv.children).toEqual([]);

    // Deleted block still in snapshot but marked deleted: true
    const [deletedBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, del.commitId),
          eq(blockVersions.blockId, para.blockId),
        ),
      );
    expect(deletedBv.deleted).toBe(true);
    expect(deletedBv.properties).toEqual({ text: 'To be deleted' });

    // Snapshot still contains both blocks (soft-delete keeps them)
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, del.commitId));
    expect(snapRows).toHaveLength(2);

    // Branch head advanced to the new commit
    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, root.branchId));
    expect(branch.headCommitId).toBe(del.commitId);
  });

  it('soft-deletes a block and all its descendants recursively', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    // Build: root -> container -> [paraA, paraB]
    const container = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Container' },
      },
    });

    const paraA = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: container.blockId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    const paraB = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: container.blockId,
        type: 'image',
        properties: { src: '/b.png' },
      },
    });

    // Delete the container — should soft-delete container + paraA + paraB
    const del = await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: container.blockId,
      },
    });

    // All three deleted blocks are marked deleted: true
    for (const blockId of [container.blockId, paraA.blockId, paraB.blockId]) {
      const [bv] = await db
        .select()
        .from(blockVersions)
        .where(
          and(
            eq(blockVersions.commitId, del.commitId),
            eq(blockVersions.blockId, blockId),
          ),
        );
      expect(bv.deleted).toBe(true);
    }

    // Snapshot contains all 4 blocks (root + 3 soft-deleted)
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, del.commitId));
    expect(snapRows).toHaveLength(4);

    // Root's children[] no longer contains the container
    const [rootBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, del.commitId),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(rootBv.children).toEqual([]);
  });

  it('only removes the deleted block from siblings, preserving others', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const a = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    const b = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'B' },
      },
    });

    const c = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'C' },
      },
    });

    // Delete B — [A, B, C] → parent children = [A, C], B soft-deleted
    const del = await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: b.blockId,
      },
    });

    // Parent's children[] is [A, C]
    const [parentBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, del.commitId),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(parentBv.children).toEqual([a.blockId, c.blockId]);

    // Snapshot has all 4 blocks (root + A + B soft-deleted + C)
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, del.commitId));
    expect(snapRows).toHaveLength(4);

    // B is soft-deleted, A and C are not
    const [bBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, del.commitId),
          eq(blockVersions.blockId, b.blockId),
        ),
      );
    expect(bBv.deleted).toBe(true);
  });

  it('getBlockTree excludes soft-deleted blocks from the tree', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const a = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    const b = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'B' },
      },
    });

    // Delete A
    await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: a.blockId,
      },
    });

    // getBlockTree should only show B as child
    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].blockId).toBe(b.blockId);
  });

  it('soft-deletes a root block and hides it from listRoots', async () => {
    const { cms } = await setupTestCMS();

    const root1 = await cms.api.pages.createRoot({
      body: { slug: '/page-1', properties: { title: 'Page 1' } },
    });

    await cms.api.pages.createRoot({
      body: { slug: '/page-2', properties: { title: 'Page 2' } },
    });

    // Delete root1
    await cms.api.pages.deleteBlock({
      body: {
        rootId: root1.rootId,
        branchId: root1.branchId,
        blockId: root1.rootId,
      },
    });

    // listRoots should only return the non-deleted root
    const result = await cms.api.pages.listRoots();
    expect(result.roots).toHaveLength(1);
    expect((result.roots[0].properties as any).title).toBe('Page 2');
  });

  it('soft-deletes a root block and all its descendants', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const child = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Child' },
      },
    });

    const del = await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: root.rootId,
      },
    });

    // Both root and child are soft-deleted
    for (const blockId of [root.rootId, child.blockId]) {
      const [bv] = await db
        .select()
        .from(blockVersions)
        .where(
          and(
            eq(blockVersions.commitId, del.commitId),
            eq(blockVersions.blockId, blockId),
          ),
        );
      expect(bv.deleted).toBe(true);
    }

    // Snapshot still contains both blocks
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, del.commitId));
    expect(snapRows).toHaveLength(2);
  });

  it('rejects deleting a block that does not exist', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.deleteBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: 'nonexistent-block-id',
        },
      }),
    ).rejects.toThrow(/Block not found in snapshot/);
  });

  it('rejects deleting an already deleted block', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const para = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    // Delete once
    await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: para.blockId,
      },
    });

    // Delete again — should fail
    await expect(
      cms.api.pages.deleteBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: para.blockId,
        },
      }),
    ).rejects.toThrow(/Block is already deleted/);
  });

  it('getBlockTree throws when the root block itself is soft-deleted', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Child' },
      },
    });

    // Soft-delete the root
    await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: root.rootId,
      },
    });

    // getBlockTree filters out deleted blocks — root is gone from the node map
    await expect(
      cms.api.pages.getBlockTree({
        query: { rootId: root.rootId, branchId: root.branchId },
      }),
    ).rejects.toThrow(/Root block not found in snapshot/);
  });
});

describe('duplicateBlock', () => {
  it('duplicates a leaf child block with same type and properties', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const para = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Hello' },
      },
    });

    const dup = await cms.api.pages.duplicateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: para.blockId,
        targetParentBlockId: root.rootId,
        message: 'Duplicate intro paragraph',
      },
    });

    expect(dup.mode).toBe('child');
    if (dup.mode !== 'child') throw new Error('Expected child mode');

    expect(dup.blockId).not.toBe(para.blockId);

    const [dupCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, dup.commitId));
    expect(dupCommit.message).toBe('Duplicate intro paragraph');

    // The duplicated block version has the same type and properties
    const [dupBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, dup.commitId),
          eq(blockVersions.blockId, dup.blockId),
        ),
      );
    expect(dupBv.type).toBe('paragraph');
    expect(dupBv.properties).toEqual({ text: 'Hello' });
    expect(dupBv.children).toEqual([]);

    // Parent now has both the original and the duplicate
    const [parentBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, dup.commitId),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(parentBv.children).toEqual([para.blockId, dup.blockId]);

    // Snapshot has root + original + duplicate
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, dup.commitId));
    expect(snapRows).toHaveLength(3);
    const snapBlockIds = snapRows.map((s) => s.blockId).sort();
    expect(snapBlockIds).toEqual(
      [root.rootId, para.blockId, dup.blockId].sort(),
    );
  });

  it('deep-copies a subtree with all descendants getting new IDs', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    // Build: root -> container -> [paraA, paraB]
    const container = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Container' },
      },
    });

    const paraA = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: container.blockId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    const paraB = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: container.blockId,
        type: 'image',
        properties: { src: '/b.png' },
      },
    });

    // Duplicate the container (which has 2 children)
    const dup = await cms.api.pages.duplicateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: container.blockId,
        targetParentBlockId: root.rootId,
      },
    });

    expect(dup.mode).toBe('child');
    if (dup.mode !== 'child') throw new Error('Expected child mode');

    // The duplicated container has a new ID
    expect(dup.blockId).not.toBe(container.blockId);

    // Load the duplicated container's block version
    const [dupContainerBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, dup.commitId),
          eq(blockVersions.blockId, dup.blockId),
        ),
      );
    expect(dupContainerBv.type).toBe('paragraph');
    expect(dupContainerBv.properties).toEqual({ text: 'Container' });
    expect(dupContainerBv.children).toHaveLength(2);

    // Children IDs are all new (not the originals)
    expect(dupContainerBv.children).not.toContain(paraA.blockId);
    expect(dupContainerBv.children).not.toContain(paraB.blockId);

    // Load the duplicated children and verify type/properties are preserved
    const dupChildA = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, dup.commitId),
          eq(blockVersions.blockId, (dupContainerBv.children as string[])[0]),
        ),
      );
    expect(dupChildA[0].type).toBe('paragraph');
    expect(dupChildA[0].properties).toEqual({ text: 'A' });

    const dupChildB = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, dup.commitId),
          eq(blockVersions.blockId, (dupContainerBv.children as string[])[1]),
        ),
      );
    expect(dupChildB[0].type).toBe('image');
    expect(dupChildB[0].properties).toEqual({ src: '/b.png' });

    // Snapshot: root + original container + paraA + paraB + dup container + 2 dup children = 7
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, dup.commitId));
    expect(snapRows).toHaveLength(7);

    // Root's children[] now has both the original container and the duplicate
    const [rootBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, dup.commitId),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(rootBv.children).toEqual([container.blockId, dup.blockId]);
  });

  it('duplicates an entire root with a deep tree and overridden properties', async () => {
    const { cms, db } = await setupTestCMS();

    // Build: root -> container -> [paraA, paraB]  (3 levels)
    const root = await cms.api.pages.createRoot({
      body: { slug: '/original', properties: { title: 'Original' } },
    });

    const container = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Container' },
      },
    });

    const paraA = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: container.blockId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    const paraB = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: container.blockId,
        type: 'image',
        properties: { src: '/b.png' },
      },
    });

    const dup = await cms.api.pages.duplicateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: root.rootId,
        message: 'Duplicate original page',
        targetSlug: '/copy',
        targetProperties: { title: 'Copy of Original' },
      },
    });

    expect(dup.mode).toBe('root');
    if (dup.mode !== 'root') throw new Error('Expected root mode');

    const [newRoot] = await db
      .select()
      .from(roots)
      .where(eq(roots.id, dup.rootId));
    expect(newRoot.collection).toBe('pages');
    expect(newRoot.id).not.toBe(root.rootId);

    // New branch and commit
    const [newBranch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, dup.branchId));
    expect(newBranch.name).toBe('main');
    expect(newBranch.rootId).toBe(dup.rootId);
    expect(newBranch.headCommitId).toBe(dup.commitId);

    const [newCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, dup.commitId));
    expect(newCommit.rootId).toBe(dup.rootId);
    expect(newCommit.parentCommitId).toBeNull();
    expect(newCommit.message).toBe('Duplicate original page');

    // Root block version has overridden properties
    const [rootBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, dup.commitId),
          eq(blockVersions.blockId, dup.rootId),
        ),
      );
    expect(rootBv.properties).toEqual({
      title: 'Copy of Original',
    });
    expect(rootBv.children).toHaveLength(1);

    // Container was duplicated — new ID, parentBlockId points to new root
    const dupContainerId = (rootBv.children as string[])[0];
    expect(dupContainerId).not.toBe(container.blockId);

    const [dupContainerBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, dup.commitId),
          eq(blockVersions.blockId, dupContainerId),
        ),
      );
    expect(dupContainerBv.type).toBe('paragraph');
    expect(dupContainerBv.properties).toEqual({ text: 'Container' });
    expect(dupContainerBv.children).toHaveLength(2);

    // Grandchildren were duplicated — new IDs, parentBlockId points to new container
    const [dupChildAId, dupChildBId] = dupContainerBv.children as string[];
    expect(dupChildAId).not.toBe(paraA.blockId);
    expect(dupChildBId).not.toBe(paraB.blockId);

    const [dupChildA] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, dup.commitId),
          eq(blockVersions.blockId, dupChildAId),
        ),
      );
    expect(dupChildA.type).toBe('paragraph');
    expect(dupChildA.properties).toEqual({ text: 'A' });

    const [dupChildB] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, dup.commitId),
          eq(blockVersions.blockId, dupChildBId),
        ),
      );
    expect(dupChildB.type).toBe('image');
    expect(dupChildB.properties).toEqual({ src: '/b.png' });

    // Snapshot has all 4 blocks (root + container + 2 grandchildren)
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, dup.commitId));
    expect(snapRows).toHaveLength(4);
    const snapBlockIds = snapRows.map((s) => s.blockId).sort();
    expect(snapBlockIds).toEqual(
      [dup.rootId, dupContainerId, dupChildAId, dupChildBId].sort(),
    );
  });

  it('rejects root duplication without targetProperties', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.duplicateBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: root.rootId,
        },
      }),
    ).rejects.toThrow(/targetProperties is required when duplicating a root/);
  });

  it('rejects duplicating a deleted block', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/duplicate-deleted', properties: { title: 'Page' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'To delete' },
      },
    });

    await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: block.blockId,
      },
    });

    await expect(
      cms.api.pages.duplicateBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: block.blockId,
          targetParentBlockId: root.rootId,
        },
      }),
    ).rejects.toThrow(/Block is already deleted/);
  });

  it('rejects duplicating into a deleted parent', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: {
        slug: '/duplicate-deleted-parent',
        properties: { title: 'Page' },
      },
    });

    const source = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Source' },
      },
    });

    const deletedParent = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Deleted parent' },
      },
    });

    await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: deletedParent.blockId,
      },
    });

    await expect(
      cms.api.pages.duplicateBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: source.blockId,
          targetParentBlockId: deletedParent.blockId,
        },
      }),
    ).rejects.toThrow(/Block is already deleted/);
  });
});

// ============================================================================
// updateBlock Tests
// ============================================================================

describe('updateBlock', () => {
  it('partially updates a child block, merging only supplied properties', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const para = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Original text' },
      },
    });

    const update = await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: para.blockId,
        message: 'Refine paragraph copy',
        type: 'paragraph',
        properties: { text: 'Updated text' },
      },
    });

    // New commit was created
    expect(update.commitId).not.toBe(para.commitId);

    const [updateCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, update.commitId));
    expect(updateCommit.message).toBe('Refine paragraph copy');

    // Block version at the new commit has merged properties
    const [updatedBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, update.commitId),
          eq(blockVersions.blockId, para.blockId),
        ),
      );
    expect(updatedBv.type).toBe('paragraph');
    expect(updatedBv.properties).toEqual({ text: 'Updated text' });

    // Branch head advanced
    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, root.branchId));
    expect(branch.headCommitId).toBe(update.commitId);
  });

  it('preserves omitted properties during partial update', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const img = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: '/photo.png', alt: 'A photo' },
      },
    });

    // Only update alt, leave src unchanged
    const update = await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: img.blockId,
        type: 'image',
        properties: { alt: 'Updated alt text' },
      },
    });

    const [updatedBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, update.commitId),
          eq(blockVersions.blockId, img.blockId),
        ),
      );
    expect(updatedBv.properties).toEqual({
      src: '/photo.png',
      alt: 'Updated alt text',
    });
  });

  it('deletes a property when it is set to null (PATCH semantics)', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const img = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: '/photo.png', alt: 'A photo' },
      },
    });

    // Setting `alt` to null removes it; `src` (omitted) is left unchanged.
    const update = await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: img.blockId,
        type: 'image',
        properties: { alt: null },
      },
    });

    const [updatedBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, update.commitId),
          eq(blockVersions.blockId, img.blockId),
        ),
      );
    expect(updatedBv.properties).toEqual({ src: '/photo.png' });
    expect(updatedBv.properties).not.toHaveProperty('alt');
  });

  it('preserves children[] and parentBlockId of the updated block', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const container = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Container' },
      },
    });

    const child = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: container.blockId,
        type: 'paragraph',
        properties: { text: 'Child' },
      },
    });

    // Update the container's text — children should remain intact
    const update = await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: container.blockId,
        type: 'paragraph',
        properties: { text: 'Updated Container' },
      },
    });

    const [containerBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, update.commitId),
          eq(blockVersions.blockId, container.blockId),
        ),
      );
    expect(containerBv.properties).toEqual({ text: 'Updated Container' });
    expect(containerBv.children).toEqual([child.blockId]);
  });

  it("updates a root block's properties", async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/old', properties: { title: 'Old Title' } },
    });

    const update = await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        message: 'Rename page',
        properties: { title: 'New Title' },
      },
    });

    const [rootBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, update.commitId),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    // title updated
    expect(rootBv.properties).toEqual({ title: 'New Title' });

    const [updateCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, update.commitId));
    expect(updateCommit.message).toBe('Rename page');
  });

  it('snapshot is complete after update — all blocks present', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const a = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    const b = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'B' },
      },
    });

    // Update only block A
    const update = await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: a.blockId,
        type: 'paragraph',
        properties: { text: 'A updated' },
      },
    });

    // Snapshot should still contain all 3 blocks
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, update.commitId));
    expect(snapRows).toHaveLength(3);
    const snapBlockIds = snapRows.map((s) => s.blockId).sort();
    expect(snapBlockIds).toEqual([root.rootId, a.blockId, b.blockId].sort());

    // Block B is unchanged
    const bSnap = snapRows.find((s) => s.blockId === b.blockId)!;
    const [bBv] = await db
      .select()
      .from(blockVersions)
      .where(eq(blockVersions.id, bSnap.blockVersionId));
    expect(bBv.properties).toEqual({ text: 'B' });
  });

  it('rejects updating a deleted block', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const para = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'To delete' },
      },
    });

    await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: para.blockId,
      },
    });

    await expect(
      cms.api.pages.updateBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: para.blockId,
          type: 'paragraph',
          properties: { text: 'Should fail' },
        },
      }),
    ).rejects.toThrow(/Block is already deleted/);
  });

  it('rejects type mismatch between input and existing block', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const para = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Hello' },
      },
    });

    await expect(
      cms.api.pages.updateBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: para.blockId,
          type: 'image',
          properties: { src: '/img.png' },
        },
      }),
    ).rejects.toThrow(/Type mismatch/);
  });

  it('getBlockTree reflects updated properties', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const para = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Before' },
      },
    });

    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: para.blockId,
        type: 'paragraph',
        properties: { text: 'After' },
      },
    });

    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].properties).toEqual({ text: 'After' });
  });

  it('commit chain is maintained across multiple updates', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const para = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'V1' },
      },
    });

    const update1 = await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: para.blockId,
        type: 'paragraph',
        properties: { text: 'V2' },
      },
    });

    const update2 = await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: para.blockId,
        type: 'paragraph',
        properties: { text: 'V3' },
      },
    });

    // Commit chain: initial → createBlock → update1 → update2
    const [commit2] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, update2.commitId));
    expect(commit2.parentCommitId).toBe(update1.commitId);

    const [commit1] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, update1.commitId));
    expect(commit1.parentCommitId).toBe(para.commitId);

    // Final version has V3
    const [finalBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, update2.commitId),
          eq(blockVersions.blockId, para.blockId),
        ),
      );
    expect(finalBv.properties).toEqual({ text: 'V3' });
  });
});

// ============================================================================
// updateBlocks (batch) Tests
// ============================================================================

describe('updateBlocks', () => {
  it('updates multiple block properties in a single commit', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const a = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    const b = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: '/b.png' },
      },
    });

    const result = await cms.api.pages.updateBlocks({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        message: 'Batch edit',
        tree: {
          blockId: root.rootId,
          type: 'pages',
          properties: { title: 'Page' },
          children: [
            {
              blockId: a.blockId,
              type: 'paragraph',
              properties: { text: 'A updated' },
              children: [],
            },
            {
              blockId: b.blockId,
              type: 'image',
              properties: { src: '/b-updated.png' },
              children: [],
            },
          ],
        },
      },
    });

    expect(result.commitId).toBeDefined();

    const [newCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, result.commitId));
    expect(newCommit.message).toBe('Batch edit');

    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });

    expect(tree.children[0].properties).toEqual({ text: 'A updated' });
    expect(tree.children[1].properties).toEqual({ src: '/b-updated.png' });
  });

  it('adds new blocks with client-generated IDs', async () => {
    const { newId } = await import('../src/utils/nanoid');
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const newBlockId = newId('block');

    const result = await cms.api.pages.updateBlocks({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        tree: {
          blockId: root.rootId,
          type: 'pages',
          properties: { title: 'Page' },
          children: [
            {
              blockId: newBlockId,
              type: 'paragraph',
              properties: { text: 'New block' },
              children: [],
            },
          ],
        },
      },
    });

    expect(result.commitId).toBeDefined();

    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].blockId).toBe(newBlockId);
    expect(tree.children[0].type).toBe('paragraph');
    expect(tree.children[0].properties).toEqual({ text: 'New block' });

    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, result.commitId));
    const snapBlockIds = snapRows.map((s) => s.blockId).sort();
    expect(snapBlockIds).toEqual([root.rootId, newBlockId].sort());
  });

  it('removes blocks from the tree (soft-delete)', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const a = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    const b = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'B' },
      },
    });

    const result = await cms.api.pages.updateBlocks({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        tree: {
          blockId: root.rootId,
          type: 'pages',
          properties: { title: 'Page' },
          children: [
            {
              blockId: b.blockId,
              type: 'paragraph',
              properties: { text: 'B' },
              children: [],
            },
          ],
        },
      },
    });

    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].blockId).toBe(b.blockId);

    const [deletedBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, result.commitId),
          eq(blockVersions.blockId, a.blockId),
        ),
      );
    expect(deletedBv.deleted).toBe(true);
  });

  it('reorders children within the same parent', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const a = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    const b = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'B' },
      },
    });

    const c = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'C' },
      },
    });

    await cms.api.pages.updateBlocks({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        tree: {
          blockId: root.rootId,
          type: 'pages',
          properties: { title: 'Page' },
          children: [
            {
              blockId: c.blockId,
              type: 'paragraph',
              properties: { text: 'C' },
              children: [],
            },
            {
              blockId: a.blockId,
              type: 'paragraph',
              properties: { text: 'A' },
              children: [],
            },
            {
              blockId: b.blockId,
              type: 'paragraph',
              properties: { text: 'B' },
              children: [],
            },
          ],
        },
      },
    });

    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });

    expect(tree.children.map((c) => c.blockId)).toEqual([
      c.blockId,
      a.blockId,
      b.blockId,
    ]);
  });

  it('moves a block to a different parent', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const container = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Container' },
      },
    });

    const blockB = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: '/b.png' },
      },
    });

    await cms.api.pages.updateBlocks({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        tree: {
          blockId: root.rootId,
          type: 'pages',
          properties: { title: 'Page' },
          children: [
            {
              blockId: container.blockId,
              type: 'paragraph',
              properties: { text: 'Container' },
              children: [
                {
                  blockId: blockB.blockId,
                  type: 'image',
                  properties: { src: '/b.png' },
                  children: [],
                },
              ],
            },
          ],
        },
      },
    });

    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].blockId).toBe(container.blockId);
    expect(tree.children[0].children).toHaveLength(1);
    expect(tree.children[0].children[0].blockId).toBe(blockB.blockId);
  });

  it('handles mixed add + edit + delete + reorder in one call', async () => {
    const { newId } = await import('../src/utils/nanoid');
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const a = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    const b = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'B' },
      },
    });

    const c = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'C' },
      },
    });

    const newBlockId = newId('block');

    const result = await cms.api.pages.updateBlocks({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        message: 'Mixed batch',
        tree: {
          blockId: root.rootId,
          type: 'pages',
          properties: { title: 'Page Updated' },
          children: [
            {
              blockId: c.blockId,
              type: 'paragraph',
              properties: { text: 'C' },
              children: [],
            },
            {
              blockId: a.blockId,
              type: 'paragraph',
              properties: { text: 'A edited' },
              children: [],
            },
            {
              blockId: newBlockId,
              type: 'image',
              properties: { src: '/new.png' },
              children: [],
            },
          ],
        },
      },
    });

    expect(result.commitId).toBeDefined();

    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });

    expect(tree.properties).toEqual({ title: 'Page Updated' });
    expect(tree.children).toHaveLength(3);
    expect(tree.children[0].blockId).toBe(c.blockId);
    expect(tree.children[1].blockId).toBe(a.blockId);
    expect(tree.children[1].properties).toEqual({ text: 'A edited' });
    expect(tree.children[2].blockId).toBe(newBlockId);
    expect(tree.children[2].type).toBe('image');

    const allCommits = await db
      .select()
      .from(commits)
      .where(eq(commits.rootId, root.rootId));
    const batchCommit = allCommits.find((c) => c.id === result.commitId);
    expect(batchCommit!.message).toBe('Mixed batch');
  });

  it('returns current commitId without creating a new commit for no-op', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const a = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    const [branchBefore] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, root.branchId));

    const result = await cms.api.pages.updateBlocks({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        tree: {
          blockId: root.rootId,
          type: 'pages',
          properties: { title: 'Page' },
          children: [
            {
              blockId: a.blockId,
              type: 'paragraph',
              properties: { text: 'A' },
              children: [],
            },
          ],
        },
      },
    });

    expect(result.commitId).toBe(branchBefore.headCommitId);

    const [branchAfter] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, root.branchId));
    expect(branchAfter.headCommitId).toBe(branchBefore.headCommitId);
  });

  it('rejects when root does not exist', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.updateBlocks({
        body: {
          rootId: 'nonexistent-root',
          branchId: root.branchId,
          tree: {
            blockId: 'nonexistent-root',
            type: 'pages',
            properties: {},
            children: [],
          },
        },
      }),
    ).rejects.toThrow(/Root block not found/);
  });

  it('rejects when branch does not exist', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.updateBlocks({
        body: {
          rootId: root.rootId,
          branchId: 'nonexistent-branch',
          tree: {
            blockId: root.rootId,
            type: 'pages',
            properties: { title: 'Page' },
            children: [],
          },
        },
      }),
    ).rejects.toThrow(/Branch not found/);
  });

  it('creates exactly one commit for a batch of changes', async () => {
    const { newId } = await import('../src/utils/nanoid');
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const a = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'A' },
      },
    });

    const commitsBefore = await db
      .select()
      .from(commits)
      .where(eq(commits.rootId, root.rootId));
    const countBefore = commitsBefore.length;

    const newId1 = newId('block');
    const newId2 = newId('block');

    await cms.api.pages.updateBlocks({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        tree: {
          blockId: root.rootId,
          type: 'pages',
          properties: { title: 'Page Edited' },
          children: [
            {
              blockId: a.blockId,
              type: 'paragraph',
              properties: { text: 'A edited' },
              children: [],
            },
            {
              blockId: newId1,
              type: 'paragraph',
              properties: { text: 'New 1' },
              children: [],
            },
            {
              blockId: newId2,
              type: 'image',
              properties: { src: '/new2.png' },
              children: [],
            },
          ],
        },
      },
    });

    const commitsAfter = await db
      .select()
      .from(commits)
      .where(eq(commits.rootId, root.rootId));

    expect(commitsAfter.length).toBe(countBefore + 1);
  });

  it('snapshot is complete after batch update — all blocks present', async () => {
    const { newId } = await import('../src/utils/nanoid');
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const existing = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Existing' },
      },
    });

    const newBlockId = newId('block');

    const result = await cms.api.pages.updateBlocks({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        tree: {
          blockId: root.rootId,
          type: 'pages',
          properties: { title: 'Page' },
          children: [
            {
              blockId: existing.blockId,
              type: 'paragraph',
              properties: { text: 'Existing' },
              children: [],
            },
            {
              blockId: newBlockId,
              type: 'image',
              properties: { src: '/new.png' },
              children: [],
            },
          ],
        },
      },
    });

    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, result.commitId));

    expect(snapRows).toHaveLength(3);
    const snapBlockIds = snapRows.map((s) => s.blockId).sort();
    expect(snapBlockIds).toEqual(
      [root.rootId, existing.blockId, newBlockId].sort(),
    );
  });

  it('handles deeply nested tree structures', async () => {
    const { newId } = await import('../src/utils/nanoid');
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    const level1Id = newId('block');
    const level2Id = newId('block');
    const level3Id = newId('block');

    await cms.api.pages.updateBlocks({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        tree: {
          blockId: root.rootId,
          type: 'pages',
          properties: { title: 'Page' },
          children: [
            {
              blockId: level1Id,
              type: 'paragraph',
              properties: { text: 'Level 1' },
              children: [
                {
                  blockId: level2Id,
                  type: 'paragraph',
                  properties: { text: 'Level 2' },
                  children: [
                    {
                      blockId: level3Id,
                      type: 'paragraph',
                      properties: { text: 'Level 3' },
                      children: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    });

    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });

    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].blockId).toBe(level1Id);
    expect(tree.children[0].children).toHaveLength(1);
    expect(tree.children[0].children[0].blockId).toBe(level2Id);
    expect(tree.children[0].children[0].children).toHaveLength(1);
    expect(tree.children[0].children[0].children[0].blockId).toBe(level3Id);
  });
});

describe('middleware', () => {
  it('runs user-defined middleware and extends context with returned values', async () => {
    const { db } = await setupTestDB();

    let middlewareCallCount = 0;
    let capturedCtx: unknown;

    const collections = {
      pages: {
        label: 'Pages',
        root: {
          properties: {
            title: { type: 'string', label: 'Title', required: true },
          },
        },
        blocks: {
          paragraph: {
            label: 'Paragraph',
            properties: {
              text: { type: 'string', label: 'Text', required: true },
            },
          },
        },
      },
    } as const;

    const cms = createCMS({
      db,
      media: {
        provider: 'custom',
        hostname: '127.0.0.1:0',
        region: 'us-east-1',
        accessKeyId: 'dummy',
        secretAccessKey: 'dummy',
        bucketName: 'dummy',
        publicUrl: 'https://cdn.test.local',
        secure: false,
        forcePathStyle: true,
      },
      collections,
      middleware: async (ctx) => {
        middlewareCallCount++;
        capturedCtx = ctx;

        expect(ctx.db).toBeDefined();
        expect(ctx.collections).toBeDefined();
        expect(ctx.scope).toBe('collection');
        if (ctx.scope !== 'collection') {
          throw new Error('Expected collection-scoped middleware context');
        }
        expect(ctx.collection).toBeDefined();
        expect(ctx.collection.name).toBe('pages');
        expect(ctx.permissionResource).toBeTruthy();
        expect(ctx.operation).toMatch(/^(create|read|update|delete)$/);

        return {
          userId: 'user-123',
          customField: 'custom-value',
        };
      },
    });

    // Execute a create operation to trigger middleware
    const root = await cms.api.pages.createRoot({
      body: { properties: { title: 'Test Page' } },
    });

    const [rootRow] = await db
      .select()
      .from(roots)
      .where(eq(roots.id, root.rootId));
    const [commitRow] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, root.commitId));
    const [branchRow] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, root.branchId));

    // Verify middleware was called
    expect(middlewareCallCount).toBeGreaterThanOrEqual(1);
    expect(capturedCtx).toBeDefined();
    expect(rootRow.createdBy).toBe('user-123');
    expect(commitRow.createdBy).toBe('user-123');
    expect(branchRow.createdBy).toBe('user-123');

    // Execute a read operation
    const tree = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });
    expect(tree.tree).toBeDefined();

    // Middleware should have been called for each operation
    expect(middlewareCallCount).toBeGreaterThanOrEqual(2);
  });

  it('exposes permissionResource derived from endpoint meta', async () => {
    let capturedPermissionResource: string | undefined;

    const { cms } = await setupTestCMS({
      middleware: async (ctx) => {
        capturedPermissionResource = ctx.permissionResource;
        return {};
      },
    });

    await cms.api.pages.createRoot({
      body: { properties: { title: 'Permission Resource Test' } },
    });

    expect(capturedPermissionResource).toBe('root');
  });

  it('works without middleware when none is provided', async () => {
    const { cms } = await setupTestCMS();

    // Should work normally without middleware
    const root = await cms.api.pages.createRoot({
      body: {
        slug: '/no-middleware',
        properties: { title: 'No Middleware Test' },
      },
    });

    expect(root.rootId).toBeDefined();
    expect(root.commitId).toBeDefined();
  });
});

describe('getRoot', () => {
  it('returns a single root by id', async () => {
    const { cms } = await setupTestCMS();
    const created = await cms.api.pages.createRoot({
      body: { slug: '/about', properties: { title: 'About' } },
    });

    const root = await cms.api.pages.getRoot({
      query: { rootId: created.rootId },
    });
    expect(root.rootId).toBe(created.rootId);
    expect((root.properties as any).title).toBe('About');
  });

  it('throws ROOT_NOT_FOUND for an unknown id', async () => {
    const { cms } = await setupTestCMS();
    await expect(
      cms.api.pages.getRoot({ query: { rootId: 'root_nope' } }),
    ).rejects.toThrow(/not found/i);
  });
});

describe('getRootBySlug', () => {
  it('resolves a top-level root by its slug', async () => {
    const { cms } = await setupTestCMS();
    const created = await cms.api.pages.createRoot({
      body: { slug: '/about', properties: { title: 'About' } },
    });
    // Read the stored slug back so the test does not couple to normalization.
    const viaId = await cms.api.pages.getRoot({
      query: { rootId: created.rootId },
    });
    expect(viaId.slug).toBeTruthy();

    const root = await cms.api.pages.getRootBySlug({
      query: { slug: viaId.slug! },
    });
    expect(root.rootId).toBe(created.rootId);
  });

  it('throws ROOT_NOT_FOUND for an unknown slug', async () => {
    const { cms } = await setupTestCMS();
    await expect(
      cms.api.pages.getRootBySlug({ query: { slug: 'does-not-exist' } }),
    ).rejects.toThrow(/not found/i);
  });
});

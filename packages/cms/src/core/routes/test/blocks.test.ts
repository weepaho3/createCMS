import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { allowAnonymous, createCMS } from '../../../index';
import {
  assets,
  blockVersions,
  branches,
  commitSnapshots,
  commits,
  roots,
} from '../../../schema';
import { setupTestCMS } from '../../../test-utils/cms';
import { setupTestDB } from '../../../test-utils/db';
import { DUMMY_MEDIA_CONFIG } from '../../../test-utils/fixtures';
import { publishApprovedBranch } from '../../../test-utils/helpers';
import { resolvedLinkKeys } from '../blocks-context';

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
      .where(eq(commits.id, result.commit.id));
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
    expect(branch.headCommitId).toBe(result.commit.id);

    // Root block version stores the input properties
    const [bv] = await db
      .select()
      .from(blockVersions)
      .where(eq(blockVersions.commitId, result.commit.id));
    expect(bv.blockId).toBe(result.rootId);
    expect(bv.rootId).toBe(result.rootId);
    expect(bv.type).toBe('pages');
    expect(bv.properties).toEqual({ title: 'Home' });
    expect(bv.children).toEqual([]);

    // Commit snapshot exists for O(1) lookups
    const [snap] = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, result.commit.id));
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

    // cms-05: the slug column (roots.slug) only materializes on publish, so a
    // filter on the `slug` column below needs a published page.
    const about = await cms.api.pages.createRoot({
      body: {
        slug: '/about',
        properties: { title: 'About Us', description: 'plain' },
      },
    });
    await cms.api.pages.publishBranch({
      body: { rootId: about.rootId, branchId: about.branchId },
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

    const published = result.roots.find((r) => r.id === root1.rootId);
    const unpublished = result.roots.find((r) => r.id === root2.rootId);

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

  it('does not invert hasPublications when the wire string "false" is passed', async () => {
    // Regression guard for the z.coerce.boolean() wire trap: over HTTP a
    // client serializes booleans to strings, and `Boolean('false') === true`.
    // The string 'false' means "without publications", NOT "with" — and must
    // stay distinct from string 'true' and from omitted (both).
    const { cms } = await setupTestCMS();

    const root1 = await cms.api.pages.createRoot({
      body: { slug: '/pub', properties: { title: 'Published' } },
    });

    const root2 = await cms.api.pages.createRoot({
      body: { slug: '/unpub', properties: { title: 'Unpublished' } },
    });

    await publishApprovedBranch(cms, {
      rootId: root1.rootId,
      branchId: root1.branchId,
      publishedBy: 'user-1',
    });

    const withoutPubs = await cms.api.pages.listRoots({
      query: { hasPublications: 'false' as unknown as boolean },
    });
    expect(withoutPubs.roots.map((r) => r.id)).toEqual([root2.rootId]);

    const withPubs = await cms.api.pages.listRoots({
      query: { hasPublications: 'true' as unknown as boolean },
    });
    expect(withPubs.roots.map((r) => r.id)).toEqual([root1.rootId]);
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
      .where(eq(commits.id, child.commit.id));
    expect(newCommit.parentCommitId).toBe(root.commit.id);
    expect(newCommit.rootId).toBe(root.rootId);
    expect(newCommit.message).toBe('Add intro paragraph');

    // Child block version has correct type, properties, and parent reference
    const [childBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, child.commit.id),
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
          eq(blockVersions.commitId, child.commit.id),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(parentBv.children).toEqual([child.blockId]);

    // Snapshot contains both root block and child block
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, child.commit.id));
    const snapBlockIds = snapRows.map((s) => s.blockId).sort();
    expect(snapBlockIds).toEqual([root.rootId, child.blockId].sort());

    // Branch head advanced to the new commit
    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, root.branchId));
    expect(branch.headCommitId).toBe(child.commit.id);
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
          eq(blockVersions.commitId, second.commit.id),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(parentBv.children).toEqual([first.blockId, second.blockId]);

    // Snapshot at latest commit has all three blocks (root + 2 children)
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, second.commit.id));
    expect(snapRows).toHaveLength(3);
    const snapBlockIds = snapRows.map((s) => s.blockId).sort();
    expect(snapBlockIds).toEqual(
      [root.rootId, first.blockId, second.blockId].sort(),
    );

    // Commit chain: initial → first → second
    const [secondCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, second.commit.id));
    expect(secondCommit.parentCommitId).toBe(first.commit.id);
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
          eq(blockVersions.commitId, y.commit.id),
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

  it('rejects a negative position', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/negative-position', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.createBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          parentBlockId: root.rootId,
          position: -1,
          type: 'paragraph',
          properties: { text: 'Should fail' },
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a fractional position', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/fractional-position', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.createBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          parentBlockId: root.rootId,
          position: 1.5,
          type: 'paragraph',
          properties: { text: 'Should fail' },
        },
      }),
    ).rejects.toThrow();
  });

  it('appends when position exceeds the child count', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/overflow-position', properties: { title: 'Page' } },
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

    // `position: 100` is far beyond the current 2-child array — the insert
    // clamps to the end instead of `splice` treating it as-is (which, for a
    // positive index past the end, already appends — this pins that behaviour
    // explicitly rather than incidentally).
    const x = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        position: 100,
        type: 'paragraph',
        properties: { text: 'X at overflow position' },
      },
    });

    const [parentBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, x.commit.id),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(parentBv.children).toEqual([a.blockId, b.blockId, x.blockId]);
  });

  it('still honours a valid position', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/valid-position', properties: { title: 'Page' } },
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

    const [parentBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, x.commit.id),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(parentBv.children).toEqual([x.blockId, a.blockId, b.blockId]);
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
    // cms-05: the editor read keeps the versioned draft slug on the root node.
    expect(tree.properties).toEqual({ title: 'Page', __slug: 'page' });
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

  it('does not invert raw when the wire string "false" is passed', async () => {
    // Regression guard for the z.coerce.boolean() wire trap: over HTTP a
    // client serializes booleans to strings, and `Boolean('false') === true`.
    // The string 'false' must NOT skip variable substitution.
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: '{{brandName}} Home' } },
    });

    const resolved = await cms.api.pages.getBlockTree({
      query: {
        rootId: root.rootId,
        branchId: root.branchId,
        raw: 'false' as unknown as boolean,
      },
    });
    expect((resolved.tree.properties as { title?: unknown }).title).toBe(
      'Toerbo Home',
    );

    const raw = await cms.api.pages.getBlockTree({
      query: {
        rootId: root.rootId,
        branchId: root.branchId,
        raw: 'true' as unknown as boolean,
      },
    });
    expect((raw.tree.properties as { title?: unknown }).title).toBe(
      '{{brandName}} Home',
    );
  });

  it('returns the tree at an older commit when commitId is provided', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    // After createRoot we have one commit with no children
    const initialCommitId = root.commit.id;

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
    expect(old.tree.properties).toEqual({ title: 'Page', __slug: 'page' });
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

    const c2CommitId = para.commit.id;

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
        commitId: para.commit.id,
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
          eq(blockVersions.commitId, move.commit.id),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(parentBv.children).toEqual([c.blockId, a.blockId, b.blockId]);

    const [moveCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, move.commit.id));
    expect(moveCommit.message).toBe('Move C to the front');

    // Snapshot still has all 4 blocks (root + A + B + C)
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, move.commit.id));
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
          eq(blockVersions.commitId, move.commit.id),
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
          eq(blockVersions.commitId, move.commit.id),
          eq(blockVersions.blockId, containerA.blockId),
        ),
      );
    expect(containerBv.children).toEqual([blockB.blockId]);

    // Snapshot has all 3 blocks
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, move.commit.id));
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

    // deleteBlock reports the removed subtree ids (ret-20); a leaf paragraph is
    // its own whole subtree.
    expect(del.deletedBlockIds).toEqual([para.blockId]);

    // New commit is a child of the previous commit
    const [newCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, del.commit.id));
    expect(newCommit.parentCommitId).toBe(para.commit.id);
    expect(newCommit.rootId).toBe(root.rootId);
    expect(newCommit.message).toBe('Remove old paragraph');

    // Parent's children[] no longer contains the deleted block
    const [parentBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, del.commit.id),
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
          eq(blockVersions.commitId, del.commit.id),
          eq(blockVersions.blockId, para.blockId),
        ),
      );
    expect(deletedBv.deleted).toBe(true);
    expect(deletedBv.properties).toEqual({ text: 'To be deleted' });

    // Snapshot still contains both blocks (soft-delete keeps them)
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, del.commit.id));
    expect(snapRows).toHaveLength(2);

    // Branch head advanced to the new commit
    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, root.branchId));
    expect(branch.headCommitId).toBe(del.commit.id);
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
            eq(blockVersions.commitId, del.commit.id),
            eq(blockVersions.blockId, blockId),
          ),
        );
      expect(bv.deleted).toBe(true);
    }

    // Snapshot contains all 4 blocks (root + 3 soft-deleted)
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, del.commit.id));
    expect(snapRows).toHaveLength(4);

    // Root's children[] no longer contains the container
    const [rootBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, del.commit.id),
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
          eq(blockVersions.commitId, del.commit.id),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(parentBv.children).toEqual([a.blockId, c.blockId]);

    // Snapshot has all 4 blocks (root + A + B soft-deleted + C)
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, del.commit.id));
    expect(snapRows).toHaveLength(4);

    // B is soft-deleted, A and C are not
    const [bBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, del.commit.id),
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
            eq(blockVersions.commitId, del.commit.id),
            eq(blockVersions.blockId, blockId),
          ),
        );
      expect(bv.deleted).toBe(true);
    }

    // Snapshot still contains both blocks
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, del.commit.id));
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
  it('rejects a call with no targetParentBlockId', async () => {
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

    // targetParentBlockId is required by the schema now (root mode moved to
    // duplicateRoot); cast past the type to exercise the runtime path a
    // non-TS caller (raw HTTP, or a client bypassing types) would hit.
    await expect(
      cms.api.pages.duplicateBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: para.blockId,
        } as any,
      }),
    ).rejects.toThrow(/targetParentBlockId|use duplicateRoot/i);
  });

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
      .where(eq(commits.id, dup.commit.id));
    expect(dupCommit.message).toBe('Duplicate intro paragraph');

    // The duplicated block version has the same type and properties
    const [dupBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, dup.commit.id),
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
          eq(blockVersions.commitId, dup.commit.id),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    expect(parentBv.children).toEqual([para.blockId, dup.blockId]);

    // Snapshot has root + original + duplicate
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, dup.commit.id));
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
          eq(blockVersions.commitId, dup.commit.id),
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
          eq(blockVersions.commitId, dup.commit.id),
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
          eq(blockVersions.commitId, dup.commit.id),
          eq(blockVersions.blockId, (dupContainerBv.children as string[])[1]),
        ),
      );
    expect(dupChildB[0].type).toBe('image');
    expect(dupChildB[0].properties).toEqual({ src: '/b.png' });

    // Snapshot: root + original container + paraA + paraB + dup container + 2 dup children = 7
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, dup.commit.id));
    expect(snapRows).toHaveLength(7);

    // Root's children[] now has both the original container and the duplicate
    const [rootBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, dup.commit.id),
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

    const dup = await cms.api.pages.duplicateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: root.rootId,
        message: 'Duplicate original page',
        targetSlug: '/copy',
        targetProperties: { title: 'Copy of Original' },
      },
    });

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
    expect(newBranch.headCommitId).toBe(dup.commit.id);

    const [newCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, dup.commit.id));
    expect(newCommit.rootId).toBe(dup.rootId);
    expect(newCommit.parentCommitId).toBeNull();
    expect(newCommit.message).toBe('Duplicate original page');

    // Root block version has overridden properties
    const [rootBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, dup.commit.id),
          eq(blockVersions.blockId, dup.rootId),
        ),
      );
    // cms-05: the duplicate seeds its slug as the versioned draft `__slug` on the
    // new root version (roots.slug stays null until publish).
    expect(rootBv.properties).toEqual({
      title: 'Copy of Original',
      __slug: 'copy',
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
          eq(blockVersions.commitId, dup.commit.id),
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
          eq(blockVersions.commitId, dup.commit.id),
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
          eq(blockVersions.commitId, dup.commit.id),
          eq(blockVersions.blockId, dupChildBId),
        ),
      );
    expect(dupChildB.type).toBe('image');
    expect(dupChildB.properties).toEqual({ src: '/b.png' });

    // Snapshot has all 4 blocks (root + container + 2 grandchildren)
    const snapRows = await db
      .select()
      .from(commitSnapshots)
      .where(eq(commitSnapshots.commitId, dup.commit.id));
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

    // Root duplication now lives on duplicateRoot, where targetProperties is a
    // REQUIRED schema field — omitting it is a schema validation error, not
    // the runtime MISSING_TARGET_PROPERTIES check (which duplicateBlock used
    // to throw when it still had a root mode). Accept either shape.
    await expect(
      cms.api.pages.duplicateRoot({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: root.rootId,
        } as any,
      }),
    ).rejects.toThrow(
      /targetProperties is required when duplicating a root|targetProperties/i,
    );
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
// duplicateRoot Tests (cms-21)
// ============================================================================

describe('duplicateRoot', () => {
  it('clones the whole tree into a new root and returns rootId + branchId', async () => {
    const { cms, db } = await setupTestCMS();

    // Source: root -> container -> leaf (3 levels).
    const root = await cms.api.pages.createRoot({
      body: {
        slug: '/source',
        properties: { title: 'Source', description: 'Desc' },
      },
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
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: container.blockId,
        type: 'paragraph',
        properties: { text: 'Leaf' },
      },
    });

    const dup = await cms.api.pages.duplicateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: root.rootId,
        targetSlug: '/source-copy',
        targetProperties: { title: 'Source (copy)' },
      },
    });

    // Returns a fresh root + branch (like createRoot) — no `mode` discriminant.
    expect(dup.rootId).not.toBe(root.rootId);
    expect(typeof dup.branchId).toBe('string');
    // cms-05: `slug` is the DRAFT slug; roots.slug stays null until publish.
    expect(dup.slug).toBe('source-copy');

    const [newRoot] = await db
      .select()
      .from(roots)
      .where(eq(roots.id, dup.rootId));
    expect(newRoot.collection).toBe('pages');
    expect(newRoot.slug).toBeNull();
    expect(newRoot.parentRootId).toBeNull();

    // The new branch is the returned one and points at the duplicate commit.
    const [newBranch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, dup.branchId));
    expect(newBranch.name).toBe('main');
    expect(newBranch.rootId).toBe(dup.rootId);
    expect(newBranch.headCommitId).toBe(dup.commit.id);

    // Cloned tree mirrors the source shape with fresh block ids + overridden
    // root properties.
    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: dup.rootId, branchId: dup.branchId, raw: true },
    });
    expect(tree.blockId).toBe(dup.rootId);
    // cms-05: editor read keeps the versioned draft slug on the root node.
    expect(tree.properties).toEqual({
      title: 'Source (copy)',
      __slug: 'source-copy',
    });
    expect(tree.children).toHaveLength(1);
    const newContainer = tree.children[0];
    expect(newContainer.blockId).not.toBe(container.blockId);
    expect(newContainer.type).toBe('paragraph');
    expect(newContainer.properties).toEqual({ text: 'Container' });
    expect(newContainer.children).toHaveLength(1);
    expect(newContainer.children[0].properties).toEqual({ text: 'Leaf' });

    // Source root is untouched.
    const src = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId, raw: true },
    });
    expect(src.tree.children).toHaveLength(1);
  });

  it('rejects targetProperties violating the property schema', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/schema-source', properties: { title: 'Source' } },
    });

    // `pages.root.properties.title` is `required: true`; omitting it violates
    // the same schema `createRoot` enforces via `buildPropertiesSchema`.
    await expect(
      cms.api.pages.duplicateRoot({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: root.rootId,
          targetSlug: '/schema-copy',
          targetProperties: { description: 'Missing the required title' },
        },
      }),
    ).rejects.toThrow(/Invalid targetProperties/i);
  });

  it('still accepts valid targetProperties', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/schema-source-valid', properties: { title: 'Source' } },
    });

    const dup = await cms.api.pages.duplicateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: root.rootId,
        targetSlug: '/schema-copy-valid',
        targetProperties: {
          title: 'Valid Copy',
          description: 'A valid description',
        },
      },
    });

    const [newRoot] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, dup.commit.id),
          eq(blockVersions.blockId, dup.rootId),
        ),
      );
    expect(newRoot.properties).toEqual({
      title: 'Valid Copy',
      description: 'A valid description',
      __slug: 'schema-copy-valid',
    });
  });
});

// ============================================================================
// Optimistic concurrency — expectedHeadCommitId (cms-18)
// ============================================================================

describe('optimistic concurrency (expectedHeadCommitId)', () => {
  it('rejects a stale head with HEAD_MISMATCH and accepts the current head', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/concurrency', properties: { title: 'Page' } },
    });
    const staleHead = root.commit.id;

    // A block create advances the branch head past `staleHead`.
    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Hi' },
      },
    });
    const currentHead = block.commit.id;
    expect(currentHead).not.toBe(staleHead);

    // Deleting on the now-stale head is rejected.
    await expect(
      cms.api.pages.deleteBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: block.blockId,
          expectedHeadCommitId: staleHead,
        },
      }),
    ).rejects.toThrow(/advanced since/);

    // Deleting on the correct head succeeds.
    const del = await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: block.blockId,
        expectedHeadCommitId: currentHead,
      },
    });
    expect(del.commit.id).not.toBe(currentHead);
  });

  it('is unchecked when omitted (backward compatible)', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/concurrency-omit', properties: { title: 'Page' } },
    });
    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Hi' },
      },
    });

    // No expectedHeadCommitId → succeeds regardless of head movement.
    const del = await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: block.blockId,
      },
    });
    expect(typeof del.commit.id).toBe('string');
  });
});

// ============================================================================
// Write-time image existence (cms-04)
// ============================================================================

describe('write-time image existence (cms-04)', () => {
  it('rejects an image property pointing at a nonexistent asset id', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/img', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.createBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          parentBlockId: root.rootId,
          type: 'image',
          properties: { src: 'ast_doesnotexist0000000' },
        },
      }),
    ).rejects.toThrow(/image asset does not exist/);
  });

  it('accepts an image property pointing at an existing asset id', async () => {
    const { cms, db } = await setupTestCMS();

    const [asset] = await db
      .insert(assets)
      .values({
        slug: 'real.png',
        mimeType: 'image/png',
        size: 100,
        objectKey: 'real.png',
      })
      .returning();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/img-ok', properties: { title: 'Page' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: asset.id },
      },
    });
    expect(typeof block.blockId).toBe('string');
  });

  it('leaves a legacy path-style image value untouched (not an id)', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/img-path', properties: { title: 'Page' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'image',
        properties: { src: '/legacy.png' },
      },
    });
    expect(typeof block.blockId).toBe('string');
  });
});

// ============================================================================
// Write-time list existence (cms-03)
// ============================================================================

// A `list` of `image` / `reference` is walked element-by-element by the
// write-time existence check, exactly like the scalar image/reference case, so a
// nonexistent id inside the list is rejected at write time. (Before the fix, the
// existence check skipped `list` properties entirely.)
describe('write-time list existence (cms-03)', () => {
  async function setupListCMS() {
    const { db } = await setupTestDB();
    const cms = createCMS({
      db,
      media: DUMMY_MEDIA_CONFIG,
      authMiddleware: allowAnonymous(),
      collections: {
        pages: {
          label: 'Pages',
          root: {
            properties: {
              title: { type: 'string', label: 'Title', required: true },
            },
          },
          blocks: {
            gallery: {
              label: 'Gallery',
              properties: {
                images: {
                  type: 'list',
                  of: { type: 'image' },
                  label: 'Images',
                },
                related: {
                  type: 'list',
                  of: { type: 'reference', collection: 'pages' },
                  label: 'Related',
                },
              },
            },
          },
        },
      } as const,
    });
    return { cms: cms as { api: Record<string, any> }, db };
  }

  it('rejects a list-of-image element pointing at a nonexistent asset id', async () => {
    const { cms } = await setupListCMS();

    const root = await cms.api.pages.createRoot({
      body: { properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.createBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          parentBlockId: root.rootId,
          type: 'gallery',
          properties: { images: ['ast_doesnotexist0000000'] },
        },
      }),
    ).rejects.toThrow(/image asset does not exist/);
  });

  it('rejects a list-of-reference element pointing at a nonexistent rootId', async () => {
    const { cms } = await setupListCMS();

    const root = await cms.api.pages.createRoot({
      body: { properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.createBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          parentBlockId: root.rootId,
          type: 'gallery',
          properties: { related: ['rot_doesnotexist000000'] },
        },
      }),
    ).rejects.toThrow(/pages does not exist/);
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
    expect(update.commit.id).not.toBe(para.commit.id);

    const [updateCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, update.commit.id));
    expect(updateCommit.message).toBe('Refine paragraph copy');

    // Block version at the new commit has merged properties
    const [updatedBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, update.commit.id),
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
    expect(branch.headCommitId).toBe(update.commit.id);
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
          eq(blockVersions.commitId, update.commit.id),
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
          eq(blockVersions.commitId, update.commit.id),
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
          eq(blockVersions.commitId, update.commit.id),
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
          eq(blockVersions.commitId, update.commit.id),
          eq(blockVersions.blockId, root.rootId),
        ),
      );
    // title updated; cms-05: the draft slug seeded at createRoot ('old') rides the
    // root version's `__slug` and is preserved through this property patch.
    expect(rootBv.properties).toEqual({ title: 'New Title', __slug: 'old' });

    const [updateCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, update.commit.id));
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
      .where(eq(commitSnapshots.commitId, update.commit.id));
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
      .where(eq(commits.id, update2.commit.id));
    expect(commit2.parentCommitId).toBe(update1.commit.id);

    const [commit1] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, update1.commit.id));
    expect(commit1.parentCommitId).toBe(para.commit.id);

    // Final version has V3
    const [finalBv] = await db
      .select()
      .from(blockVersions)
      .where(
        and(
          eq(blockVersions.commitId, update2.commit.id),
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

    expect(result.commit.id).toBeDefined();
    // A real save reports changed:true (ret-04).
    expect(result.changed).toBe(true);

    const [newCommit] = await db
      .select()
      .from(commits)
      .where(eq(commits.id, result.commit.id));
    expect(newCommit.message).toBe('Batch edit');

    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });

    expect(tree.children[0].properties).toEqual({ text: 'A updated' });
    expect(tree.children[1].properties).toEqual({ src: '/b-updated.png' });
  });

  it('adds new blocks with client-generated IDs', async () => {
    const { newId } = await import('../../../utils/nanoid');
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

    expect(result.commit.id).toBeDefined();

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
      .where(eq(commitSnapshots.commitId, result.commit.id));
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
          eq(blockVersions.commitId, result.commit.id),
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
    const { newId } = await import('../../../utils/nanoid');
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

    await cms.api.pages.createBlock({
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

    expect(result.commit.id).toBeDefined();

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
    const batchCommit = allCommits.find((c) => c.id === result.commit.id);
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
          // cms-05: the stored root version carries the versioned draft slug, so
          // an identical round-trip must include it to stay a no-op.
          properties: { title: 'Page', __slug: 'page' },
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

    expect(result.commit.id).toBe(branchBefore.headCommitId);
    // No-op is distinguishable from a real save via `changed` (ret-04).
    expect(result.changed).toBe(false);

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
    const { newId } = await import('../../../utils/nanoid');
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
    const { newId } = await import('../../../utils/nanoid');
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
      .where(eq(commitSnapshots.commitId, result.commit.id));

    expect(snapRows).toHaveLength(3);
    const snapBlockIds = snapRows.map((s) => s.blockId).sort();
    expect(snapBlockIds).toEqual(
      [root.rootId, existing.blockId, newBlockId].sort(),
    );
  });

  it('handles deeply nested tree structures', async () => {
    const { newId } = await import('../../../utils/nanoid');
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

  it('toe-ed-01: rejects an unknown block type', async () => {
    const { newId } = await import('../../../utils/nanoid');
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.updateBlocks({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          tree: {
            blockId: root.rootId,
            type: 'pages',
            properties: { title: 'Page' },
            children: [
              {
                blockId: newId('block'),
                type: 'notARealBlockType',
                properties: {},
                children: [],
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(/Unknown block type/i);
  });

  it('toe-ed-01: rejects invalid properties for a known block type', async () => {
    const { newId } = await import('../../../utils/nanoid');
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.updateBlocks({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          tree: {
            blockId: root.rootId,
            type: 'pages',
            properties: { title: 'Page' },
            children: [
              {
                blockId: newId('block'),
                // `paragraph.text` is a required richText (string) — a number
                // must be rejected, mirroring createBlock's body-schema check.
                type: 'paragraph',
                properties: { text: 123 },
                children: [],
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(/Invalid properties/i);
  });

  it('toe-ed-01: rejects a disallowed placement (leaf block given children)', async () => {
    const { newId } = await import('../../../utils/nanoid');
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    // `image` is a leaf (no allowChildren) — nesting a child under it must be
    // rejected by the placement walk, exactly like createBlock/moveBlock.
    await expect(
      cms.api.pages.updateBlocks({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          tree: {
            blockId: root.rootId,
            type: 'pages',
            properties: { title: 'Page' },
            children: [
              {
                blockId: newId('block'),
                type: 'image',
                properties: { src: '/a.png' },
                children: [
                  {
                    blockId: newId('block'),
                    type: 'paragraph',
                    properties: { text: 'nested' },
                    children: [],
                  },
                ],
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(/does not accept child blocks/i);
  });

  it('toe-ed-01: rejects a mismatched root blockId (would tombstone the real root)', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    await expect(
      cms.api.pages.updateBlocks({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          tree: {
            // Root node's blockId does NOT equal rootId.
            blockId: 'not-the-root-id',
            type: 'pages',
            properties: { title: 'Page' },
            children: [],
          },
        },
      }),
    ).rejects.toThrow(/does not match rootId/i);
  });

  it('toe-ed-01: rejects invalid ROOT properties (defect 1 — the root is no longer skipped)', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    // The root's `title` is a required string. updateRoot rejects a numeric
    // title; updateBlocks (which diffs the root `updated` and persists its
    // changed props) must reject it too. The old whole-tree validator early-
    // returned for the root, letting invalid root props slip straight through.
    await expect(
      cms.api.pages.updateBlocks({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          tree: {
            blockId: root.rootId,
            type: 'pages',
            properties: { title: 123 },
            children: [],
          },
        },
      }),
    ).rejects.toThrow(/Invalid root properties/i);
  });

  it('toe-ed-01: does NOT re-validate an UNCHANGED, now-strict-invalid sibling (defect 2)', async () => {
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    // P1: a paragraph whose required `text` is later null-deleted via a PATCH,
    // so its STORED props ({}) no longer satisfy the strict (create) schema.
    const p1 = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'original' },
      },
    });
    await cms.api.pages.updateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: p1.blockId,
        type: 'paragraph',
        properties: { text: null },
      },
    });

    // P2: the sibling the user actually edits in this batch save.
    const p2 = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'sibling' },
      },
    });

    // Load the live tree (P1 now carries {}), edit ONLY P2, and post it back —
    // the editor's real batch-save flow. The old whole-tree validator threw on
    // P1's missing required `text`; the diff-based validator skips P1 (unchanged)
    // and the save of P2 goes through.
    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId, raw: true },
    });
    const p2Node = tree.children.find((c) => c.blockId === p2.blockId)!;
    p2Node.properties = { text: 'sibling edited' };

    const result = await cms.api.pages.updateBlocks({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        tree: tree as unknown as Parameters<
          typeof cms.api.pages.updateBlocks
        >[0]['body']['tree'],
      },
    });
    expect(result.changed).toBe(true);

    const { tree: after } = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId },
    });
    const p2After = after.children.find((c) => c.blockId === p2.blockId)!;
    expect(p2After.properties).toEqual({ text: 'sibling edited' });
    // P1 is untouched — still present, still empty (the invalid sibling survived).
    const p1After = after.children.find((c) => c.blockId === p1.blockId)!;
    expect(p1After.properties).toEqual({});
  });

  it('toe-ed-01: still rejects a CREATED block missing required properties (strict create semantics)', async () => {
    const { newId } = await import('../../../utils/nanoid');
    const { cms } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    // A brand-new paragraph MUST carry its required `text`: a CREATE is held to
    // the full required-enforcing schema even though UPDATES are patch-tolerant.
    await expect(
      cms.api.pages.updateBlocks({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          tree: {
            blockId: root.rootId,
            type: 'pages',
            properties: { title: 'Page' },
            children: [
              {
                blockId: newId('block'),
                type: 'paragraph',
                properties: {},
                children: [],
              },
            ],
          },
        },
      }),
    ).rejects.toThrow(/Invalid properties/i);
  });

  it('toe-ed-02: a round-tripped getBlockTree -> updateBlocks does not corrupt the root type', async () => {
    const { cms, db } = await setupTestCMS();

    const root = await cms.api.pages.createRoot({
      body: { slug: '/page', properties: { title: 'Page' } },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'Hi' },
      },
    });

    // getBlockTree emits the root with the logical marker `type: 'root'`.
    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId, raw: true },
    });
    expect(tree.type).toBe('root');

    // Posting the freshly-loaded tree straight back must be a lossless NO-OP:
    // the `'root'` marker normalizes back to the collection name, so nothing
    // diffs. Without the fix this both persists `type: 'root'` AND reports a
    // phantom change.
    const result = await cms.api.pages.updateBlocks({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        tree: tree as unknown as Parameters<
          typeof cms.api.pages.updateBlocks
        >[0]['body']['tree'],
      },
    });
    expect(result.changed).toBe(false);

    // The STORED root version keeps the collection name, not the literal 'root'.
    const [branch] = await db
      .select()
      .from(branches)
      .where(eq(branches.id, root.branchId));
    const [rootSnap] = await db
      .select({ blockVersionId: commitSnapshots.blockVersionId })
      .from(commitSnapshots)
      .where(
        and(
          eq(commitSnapshots.commitId, branch.headCommitId),
          eq(commitSnapshots.blockId, root.rootId),
        ),
      );
    const [rootBv] = await db
      .select()
      .from(blockVersions)
      .where(eq(blockVersions.id, rootSnap.blockVersionId));
    expect(rootBv.type).toBe('pages');
  });

  // cms-04 perf: the batch save collects image/reference ids across the WHOLE
  // diff and validates them with one query per collection instead of one
  // query pair per block. These tests exercise that batched path directly
  // (as opposed to the single-block createBlock/updateBlock cms-04 tests
  // above) to prove the collect-then-validate refactor still enforces the
  // same existence check across multiple blocks in one updateBlocks call.
  describe('batched reference-existence check (cms-04 perf)', () => {
    it('accepts multiple image blocks each pointing at a distinct valid asset id', async () => {
      const { newId } = await import('../../../utils/nanoid');
      const { cms, db } = await setupTestCMS();

      const [assetA, assetB, assetC] = await db
        .insert(assets)
        .values([
          {
            slug: 'a.png',
            mimeType: 'image/png',
            size: 1,
            objectKey: 'a.png',
          },
          {
            slug: 'b.png',
            mimeType: 'image/png',
            size: 1,
            objectKey: 'b.png',
          },
          {
            slug: 'c.png',
            mimeType: 'image/png',
            size: 1,
            objectKey: 'c.png',
          },
        ])
        .returning();

      const root = await cms.api.pages.createRoot({
        body: { slug: '/batch-img-ok', properties: { title: 'Page' } },
      });

      const blockA = newId('block');
      const blockB = newId('block');
      const blockC = newId('block');

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
                blockId: blockA,
                type: 'image',
                properties: { src: assetA.id },
                children: [],
              },
              {
                blockId: blockB,
                type: 'image',
                properties: { src: assetB.id },
                children: [],
              },
              {
                blockId: blockC,
                type: 'image',
                properties: { src: assetC.id },
                children: [],
              },
            ],
          },
        },
      });

      expect(result.commit.id).toBeDefined();
      expect(result.changed).toBe(true);

      const { tree } = await cms.api.pages.getBlockTree({
        query: { rootId: root.rootId, branchId: root.branchId },
      });

      const bySrc = tree.children.map((c: any) => c.properties.src).sort();
      expect(bySrc).toEqual([assetA.id, assetB.id, assetC.id].sort());
    });

    it('rejects the batch when one of several image blocks points at a nonexistent asset id, naming that exact id', async () => {
      const { newId } = await import('../../../utils/nanoid');
      const { cms, db } = await setupTestCMS();

      const [assetA] = await db
        .insert(assets)
        .values({
          slug: 'ok.png',
          mimeType: 'image/png',
          size: 1,
          objectKey: 'ok.png',
        })
        .returning();

      const root = await cms.api.pages.createRoot({
        body: { slug: '/batch-img-bad', properties: { title: 'Page' } },
      });

      const missingId = newId('asset');

      await expect(
        cms.api.pages.updateBlocks({
          body: {
            rootId: root.rootId,
            branchId: root.branchId,
            tree: {
              blockId: root.rootId,
              type: 'pages',
              properties: { title: 'Page' },
              children: [
                {
                  blockId: newId('block'),
                  type: 'image',
                  properties: { src: assetA.id },
                  children: [],
                },
                {
                  blockId: newId('block'),
                  type: 'image',
                  properties: { src: missingId },
                  children: [],
                },
              ],
            },
          },
        }),
      ).rejects.toThrow(new RegExp(`image asset does not exist: ${missingId}`));
    });
  });
});

// ============================================================================
// updateBlocks resolved-link hint
// ============================================================================

// A tree read without `raw: true` (or a resolveTree response) carries link
// values in the READ shape (`href` / `targetRootId`); posting it back must be
// rejected with a hint naming the affected properties and `raw: true`.
describe('updateBlocks resolved-link hint', () => {
  async function setupLinkHintCMS() {
    const { db } = await setupTestDB();
    const cms = createCMS({
      db,
      media: DUMMY_MEDIA_CONFIG,
      authMiddleware: allowAnonymous(),
      collections: {
        pages: {
          label: 'Pages',
          root: {
            properties: {
              title: { type: 'string', label: 'Title', required: true },
            },
          },
          blocks: {
            cta: {
              label: 'CTA',
              properties: {
                link: { type: 'link', label: 'Link' },
                caption: { type: 'string', label: 'Caption' },
              },
            },
          },
        },
      } as const,
    });
    return { cms: cms as { api: Record<string, any> }, db };
  }

  async function updateWithCtaProperties(properties: Record<string, unknown>) {
    const { newId } = await import('../../../utils/nanoid');
    const { cms } = await setupLinkHintCMS();

    const root = await cms.api.pages.createRoot({
      body: { properties: { title: 'Page' } },
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
              blockId: newId('block'),
              type: 'cta',
              properties,
              children: [],
            },
          ],
        },
      },
    });
  }

  it('names the resolved link value and points at raw mode', async () => {
    let caught: any;
    try {
      await updateWithCtaProperties({
        link: { kind: 'external', href: '/somewhere' },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(String(caught.message)).toMatch(/looks resolved/);
    expect(String(caught.message)).toMatch(/raw: true/);
    expect(caught.body?.data.resolvedLinkKeys).toEqual(['link']);
  });

  it('a plain type error gets no resolved-link hint', async () => {
    let caught: any;
    try {
      await updateWithCtaProperties({ caption: 123 });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(String(caught.message)).toMatch(/Invalid properties/i);
    expect(String(caught.message)).not.toMatch(/looks resolved/);
    expect(caught.body?.data.resolvedLinkKeys).toBeUndefined();
  });

  it('an internal link in read shape is detected by targetRootId', async () => {
    let caught: any;
    try {
      await updateWithCtaProperties({
        link: {
          kind: 'internal',
          targetRootId: 'rot_x',
          collection: 'pages',
          href: '/x',
        },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(String(caught.message)).toMatch(/looks resolved/);
    expect(caught.body?.data.resolvedLinkKeys).toEqual(['link']);
  });
});

describe('resolvedLinkKeys', () => {
  const specs = {
    cta: { type: 'link', label: 'Link' },
    caption: { type: 'string', label: 'Caption' },
  } as const;

  it('a non-object value gets no hint', () => {
    expect(
      resolvedLinkKeys(specs, { cta: 'not-an-object' }, [{ path: ['cta'] }]),
    ).toEqual([]);
  });

  it('a store-shape link failing for another reason gets no hint', () => {
    expect(
      resolvedLinkKeys(specs, { cta: { kind: 'external', url: '' } }, [
        { path: ['cta', 'url'] },
      ]),
    ).toEqual([]);
  });

  it('an issue path deeper than the key still maps to the key', () => {
    expect(
      resolvedLinkKeys(specs, { cta: { kind: 'external', href: '/x' } }, [
        { path: ['cta', 'url'] },
      ]),
    ).toEqual(['cta']);
  });

  it('a non-link property is never named', () => {
    expect(
      resolvedLinkKeys(specs, { caption: { href: '/x' } }, [
        { path: ['caption'] },
      ]),
    ).toEqual([]);
  });
});

describe('createBlock property defaults (toe-ed-09)', () => {
  const collections = {
    pages: {
      label: 'Pages',
      root: {
        properties: {
          title: { type: 'string', label: 'Title', required: true },
        },
      },
      blocks: {
        callout: {
          label: 'Callout',
          properties: {
            tone: { type: 'string', label: 'Tone', defaultValue: 'info' },
            text: { type: 'string', label: 'Text' },
          },
        },
      },
    },
  } as const;

  it('seeds a property defaultValue when the caller omits it, and lets the caller win', async () => {
    const { db } = await setupTestDB();
    const cms = createCMS({
      db,
      media: { ...DUMMY_MEDIA_CONFIG },
      collections,
      authMiddleware: allowAnonymous(),
    });

    const root = await cms.api.pages.createRoot({
      body: { properties: { title: 'P' } },
    });

    // (1) default fills the gap the caller left.
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'callout',
        properties: { text: 'filled' },
      },
    });

    // (2) a caller-provided value overrides the default.
    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'callout',
        properties: { tone: 'warning', text: 'overridden' },
      },
    });

    const { tree } = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId, raw: true },
    });

    const [first, second] = tree.children;
    const firstProps = first.properties as Record<string, unknown>;
    const secondProps = second.properties as Record<string, unknown>;
    expect(firstProps.tone).toBe('info'); // default seeded
    expect(firstProps.text).toBe('filled');
    expect(secondProps.tone).toBe('warning'); // caller wins over default
    expect(secondProps.text).toBe('overridden');
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
      authMiddleware: async (ctx) => {
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
      .where(eq(commits.id, root.commit.id));
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
      authMiddleware: async (ctx) => {
        capturedPermissionResource = ctx.permissionResource;
        return {};
      },
    });

    await cms.api.pages.createRoot({
      body: { properties: { title: 'Permission Resource Test' } },
    });

    expect(capturedPermissionResource).toBe('root');
  });

  it('authMiddleware denial for operation delete aborts before the write', async () => {
    const { cms, db } = await setupTestCMS({
      authMiddleware: async (ctx) => {
        if (ctx.operation === 'delete') throw new Error('DENIED');
        return {};
      },
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/deny', properties: { title: 'Deny' } },
    });

    await expect(
      cms.api.pages.archiveRoot({ body: { rootId: root.rootId } }),
    ).rejects.toThrow(/denied/i);

    const [row] = await db
      .select()
      .from(roots)
      .where(eq(roots.id, root.rootId));
    expect(row).toBeDefined();
    expect(row.archivedAt).toBeNull();
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
    expect(root.commit.id).toBeDefined();
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
    expect(root.id).toBe(created.rootId);
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
  it('resolves a top-level root by its DRAFT slug (unpublished)', async () => {
    const { cms } = await setupTestCMS();
    const created = await cms.api.pages.createRoot({
      body: { slug: '/about', properties: { title: 'About' } },
    });
    // cms-05: getRootBySlug is a DRAFT read — it matches the versioned draft slug
    // (`created.slug`) even before publish, whereas getRoot().slug (published
    // roots.slug) is still null here.
    expect(created.slug).toBe('about');

    const root = await cms.api.pages.getRootBySlug({
      query: { slug: created.slug! },
    });
    expect(root.id).toBe(created.rootId);
  });

  it('throws ROOT_NOT_FOUND for an unknown slug', async () => {
    const { cms } = await setupTestCMS();
    await expect(
      cms.api.pages.getRootBySlug({ query: { slug: 'does-not-exist' } }),
    ).rejects.toThrow(/not found/i);
  });
});

// ============================================================================
// cms-05 — versioned slug (draft slug isolated per branch, materialized on publish)
// ============================================================================

describe('cms-05 versioned slug (write path)', () => {
  const dbSlug = async (db: any, rootId: string): Promise<string | null> => {
    const [r] = await db.select().from(roots).where(eq(roots.id, rootId));
    return r.slug;
  };

  it('createRoot leaves roots.slug null pre-publish and returns the draft slug', async () => {
    const { cms, db } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/about', properties: { title: 'About' } },
    });
    expect(root.slug).toBe('about');
    expect(await dbSlug(db, root.rootId)).toBeNull();
  });

  it('updateRoot does not mutate roots.slug and returns the DRAFT slug', async () => {
    const { cms, db } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/one', properties: { title: 'P' } },
    });
    const upd = await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        slug: 'two',
        properties: { title: 'P' },
      },
    });
    // Returned slug is the new DRAFT slug…
    expect(upd.slug).toBe('two');
    // …but the live roots.slug is untouched (still null — never published).
    expect(await dbSlug(db, root.rootId)).toBeNull();
    // The draft slug rides the editor tree's root node.
    const tree = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId, raw: true },
    });
    expect((tree.tree.properties as { __slug?: string }).__slug).toBe('two');
  });

  it('a slug edit on a NON-default branch is invisible to roots.slug', async () => {
    const { cms, db } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/base', properties: { title: 'P' } },
    });
    // Publish the default branch first → roots.slug materializes to 'base'.
    await cms.api.pages.publishBranch({
      body: { rootId: root.rootId, branchId: root.branchId },
    });
    expect(await dbSlug(db, root.rootId)).toBe('base');

    // Edit the slug on a NON-default variant branch.
    const variant = await cms.api.pages.createBranch({
      body: {
        rootId: root.rootId,
        name: 'variant-b',
        sourceBranchId: root.branchId,
      },
    });
    await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: variant.branch.id,
        slug: 'variant-slug',
        properties: { title: 'P' },
      },
    });
    // roots.slug is unchanged — a draft-branch slug edit does not touch it.
    expect(await dbSlug(db, root.rootId)).toBe('base');
  });

  it('the draft slug survives revertBranch (rides the root version properties)', async () => {
    const { cms } = await setupTestCMS();
    const root = await cms.api.pages.createRoot({
      body: { slug: '/first', properties: { title: 'P' } },
    });
    const atFirst = root.commit.id;

    // Rename the draft slug → 'second'.
    await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        slug: 'second',
        properties: { title: 'P' },
      },
    });
    const beforeRevert = await cms.api.pages.getRootBySlug({
      query: { slug: 'second' },
    });
    expect(beforeRevert.id).toBe(root.rootId);

    // Revert the branch back to the initial commit → draft slug is 'first' again.
    await cms.api.pages.revertBranch({
      body: { branchId: root.branchId, targetCommitId: atFirst },
    });
    const afterRevert = await cms.api.pages.getRootBySlug({
      query: { slug: 'first' },
    });
    expect(afterRevert.id).toBe(root.rootId);
    await expect(
      cms.api.pages.getRootBySlug({ query: { slug: 'second' } }),
    ).rejects.toThrow(/not found/i);
  });
});

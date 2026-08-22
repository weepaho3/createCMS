import { describe, expect, it } from 'vitest';

import { allowAnonymous, createCMS } from '../../index';
import { setupTestDB } from '../../test-utils/db';
import { DUMMY_MEDIA_CONFIG } from '../../test-utils/fixtures';

async function setupResolveTreeCMS() {
  const { db } = await setupTestDB();
  const cms = createCMS({
    db,
    authMiddleware: allowAnonymous(),
    media: { ...DUMMY_MEDIA_CONFIG },
    collections: {
      reusableBlocks: {
        label: 'Reusable Blocks',
        root: {
          properties: {
            label: { type: 'string', label: 'Label', required: true },
          },
        },
        blocks: {
          cta: {
            label: 'CTA',
            properties: {
              link: { type: 'link', label: 'Link' },
              note: { type: 'string', label: 'Note' },
            },
          },
        },
      },
      pages: {
        label: 'Pages',
        slug: { enabled: true, prefix: '/pages' },
        root: {
          properties: {
            title: { type: 'string', label: 'Title', required: true },
            intro: { type: 'string', label: 'Intro' },
          },
        },
        blocks: {
          hero: {
            label: 'Hero',
            properties: {
              headline: { type: 'string', label: 'Headline' },
              link: { type: 'link', label: 'Link' },
            },
          },
          embed: {
            label: 'Embed',
            properties: {
              block: {
                type: 'reference',
                collection: 'reusableBlocks',
                label: 'Block',
                required: true,
              },
            },
          },
          paragraph: {
            label: 'Paragraph',
            properties: {
              text: { type: 'string', label: 'Text' },
            },
          },
        },
      },
    },
  });
  return { cms: cms as { api: any }, db };
}

async function publishBranch(
  api: any,
  input: { rootId: string; branchId: string },
): Promise<void> {
  const request = await api.requestApproval({
    body: {
      branchId: input.branchId,
      requestedReviewers: ['reviewer-1'],
    },
    context: { userId: 'requester-1' },
  });
  await api.submitApproval({
    body: { approvalId: request.approvals[0].id },
    context: { userId: 'reviewer-1' },
  });
  await api.publishBranch({ body: input });
}

/**
 * Seeds: variable `brand`; a published `about` page; a published `footer`
 * reusable block whose `cta` links to `about` and whose `note` embeds
 * `{{brand}}`; and a `home` page (unpublished) with a `hero` (headline +
 * external link) and an `embed` of `footer`.
 */
async function seed(cms: { api: any }) {
  await cms.api.variables.createVariable({
    body: { key: 'brand', value: 'Toerbo' },
  });

  const about = await cms.api.pages.createRoot({
    body: { slug: 'about', properties: { title: 'About' } },
  });
  await publishBranch(cms.api.pages, {
    rootId: about.rootId,
    branchId: about.branchId,
  });

  const reusable = await cms.api.reusableBlocks.createRoot({
    body: { properties: { label: 'Footer' } },
  });
  await cms.api.reusableBlocks.createBlock({
    body: {
      rootId: reusable.rootId,
      branchId: reusable.branchId,
      parentBlockId: reusable.rootId,
      type: 'cta',
      properties: {
        link: { kind: 'internal', rootId: about.rootId, collection: 'pages' },
        note: 'Made by {{brand}}',
      },
    },
  });
  await publishBranch(cms.api.reusableBlocks, {
    rootId: reusable.rootId,
    branchId: reusable.branchId,
  });

  const home = await cms.api.pages.createRoot({
    body: { slug: 'home', properties: { title: '{{brand}} Home' } },
  });
  await cms.api.pages.createBlock({
    body: {
      rootId: home.rootId,
      branchId: home.branchId,
      parentBlockId: home.rootId,
      type: 'hero',
      properties: {
        headline: 'Hello {{brand}}',
        link: { kind: 'external', url: 'https://example.com' },
      },
    },
  });
  await cms.api.pages.createBlock({
    body: {
      rootId: home.rootId,
      branchId: home.branchId,
      parentBlockId: home.rootId,
      type: 'embed',
      properties: { block: reusable.rootId },
    },
  });

  return { about, reusable, home };
}

/** The stored, unresolved raw tree: what an editor would post back edited. */
async function treeOf(
  cms: { api: any },
  rootId: string,
  branchId: string,
): Promise<any> {
  return cms.api.pages.getBlockTree({
    query: { rootId, branchId, raw: true },
  });
}

describe('resolveTree', () => {
  it('substitutes variables in the posted tree without touching the stored head', async () => {
    const { cms } = await setupResolveTreeCMS();
    const { home } = await seed(cms);
    const raw = await treeOf(cms, home.rootId, home.branchId);

    const resolved = await cms.api.pages.resolveTree({
      body: { rootId: home.rootId, branchId: home.branchId, tree: raw.tree },
    });

    expect(resolved.tree.properties.title).toBe('Toerbo Home');
    const hero = resolved.tree.children.find((c: any) => c.type === 'hero');
    expect(hero.properties.headline).toBe('Hello Toerbo');

    // The stored head is untouched: resolveTree persists nothing.
    const stillRaw = await treeOf(cms, home.rootId, home.branchId);
    expect(stillRaw.tree.properties.title).toBe('{{brand}} Home');
  });

  it('resolves external links, and an internal link posted on the tree, to the current href', async () => {
    const { cms } = await setupResolveTreeCMS();
    const { about, home } = await seed(cms);

    const raw1 = await treeOf(cms, home.rootId, home.branchId);
    const resolved1 = await cms.api.pages.resolveTree({
      body: { rootId: home.rootId, branchId: home.branchId, tree: raw1.tree },
    });
    expect(
      resolved1.tree.children.find((c: any) => c.type === 'hero').properties
        .link,
    ).toEqual({ kind: 'external', href: 'https://example.com' });

    const raw2 = await treeOf(cms, home.rootId, home.branchId);
    const hero2 = raw2.tree.children.find((c: any) => c.type === 'hero');
    hero2.properties.link = {
      kind: 'internal',
      rootId: about.rootId,
      collection: 'pages',
    };
    const resolved2 = await cms.api.pages.resolveTree({
      body: { rootId: home.rootId, branchId: home.branchId, tree: raw2.tree },
    });
    expect(
      resolved2.tree.children.find((c: any) => c.type === 'hero').properties
        .link,
    ).toEqual({
      kind: 'internal',
      targetRootId: about.rootId,
      collection: 'pages',
      href: '/pages/about',
    });
  });

  it('returns a references sidecar of published previews when includeReferencePreviews is set, keeping the stored reference value in the tree', async () => {
    const { cms } = await setupResolveTreeCMS();
    const { about, reusable, home } = await seed(cms);
    const raw = await treeOf(cms, home.rootId, home.branchId);

    const resolved = await cms.api.pages.resolveTree({
      body: {
        rootId: home.rootId,
        branchId: home.branchId,
        tree: raw.tree,
        includeReferencePreviews: true,
      },
    });

    const preview = resolved.references?.[reusable.rootId];
    expect(preview).toBeDefined();
    expect(preview.children[0].properties.note).toBe('Made by Toerbo');
    expect(preview.children[0].properties.link).toEqual({
      kind: 'internal',
      targetRootId: about.rootId,
      collection: 'pages',
      href: '/pages/about',
    });

    const embed = resolved.tree.children.find((c: any) => c.type === 'embed');
    expect(embed.properties.block).toBe(reusable.rootId);
  });

  it('inlines reference values into their resolved published trees when inlineReferences is set', async () => {
    const { cms } = await setupResolveTreeCMS();
    const { about, reusable, home } = await seed(cms);
    const raw = await treeOf(cms, home.rootId, home.branchId);

    const resolved = await cms.api.pages.resolveTree({
      body: {
        rootId: home.rootId,
        branchId: home.branchId,
        tree: raw.tree,
        inlineReferences: true,
      },
    });

    const embed = resolved.tree.children.find((c: any) => c.type === 'embed');
    const inlined = embed.properties.block;
    expect(inlined.rootId).toBe(reusable.rootId);
    expect(inlined.collection).toBe('reusableBlocks');
    expect(inlined.tree.children[0].properties.note).toBe('Made by Toerbo');
    expect(inlined.tree.children[0].properties.link).toEqual({
      kind: 'internal',
      targetRootId: about.rootId,
      collection: 'pages',
      href: '/pages/about',
    });
    expect(resolved.references).toBeUndefined();
  });

  it('combines includeReferencePreviews and inlineReferences: both the sidecar and the inlined tree are present', async () => {
    const { cms } = await setupResolveTreeCMS();
    const { reusable, home } = await seed(cms);
    const raw = await treeOf(cms, home.rootId, home.branchId);

    const resolved = await cms.api.pages.resolveTree({
      body: {
        rootId: home.rootId,
        branchId: home.branchId,
        tree: raw.tree,
        includeReferencePreviews: true,
        inlineReferences: true,
      },
    });

    expect(resolved.references?.[reusable.rootId]).toBeDefined();
    const embed = resolved.tree.children.find((c: any) => c.type === 'embed');
    expect(embed.properties.block.rootId).toBe(reusable.rootId);
  });

  it('resolves the posted (unsaved) edits, not the stored tree, and persists nothing', async () => {
    const { cms } = await setupResolveTreeCMS();
    const { home } = await seed(cms);
    const raw = await treeOf(cms, home.rootId, home.branchId);
    const hero = raw.tree.children.find((c: any) => c.type === 'hero');
    hero.properties.headline = 'Bye {{brand}}';
    raw.tree.children.push({
      blockId: 'block_unsaved_paragraph',
      type: 'paragraph',
      properties: { text: '{{brand}} says hi' },
      children: [],
    });

    const branchBefore = await cms.api.pages.getBranch({
      query: { branchId: home.branchId },
    });

    const resolved = await cms.api.pages.resolveTree({
      body: { rootId: home.rootId, branchId: home.branchId, tree: raw.tree },
    });

    expect(
      resolved.tree.children.find((c: any) => c.type === 'hero').properties
        .headline,
    ).toBe('Bye Toerbo');
    expect(
      resolved.tree.children.find((c: any) => c.type === 'paragraph').properties
        .text,
    ).toBe('Toerbo says hi');

    // Nothing persisted: the stored tree and branch head are unchanged.
    const stillStored = await treeOf(cms, home.rootId, home.branchId);
    expect(
      stillStored.tree.children.find((c: any) => c.type === 'hero').properties
        .headline,
    ).toBe('Hello {{brand}}');
    expect(
      stillStored.tree.children.some((c: any) => c.type === 'paragraph'),
    ).toBe(false);

    const branchAfter = await cms.api.pages.getBranch({
      query: { branchId: home.branchId },
    });
    expect(branchAfter.headCommitId).toBe(branchBefore.headCommitId);
  });

  it('passes through an unknown block type and an undeclared property without throwing', async () => {
    const { cms } = await setupResolveTreeCMS();
    const { home } = await seed(cms);
    const raw = await treeOf(cms, home.rootId, home.branchId);
    const hero = raw.tree.children.find((c: any) => c.type === 'hero');
    (hero.properties as Record<string, unknown>).extra = 'keep';
    raw.tree.children.push({
      blockId: 'block_mystery',
      type: 'mystery',
      properties: { x: '{{brand}}' },
      children: [],
    });

    const resolved = await cms.api.pages.resolveTree({
      body: { rootId: home.rootId, branchId: home.branchId, tree: raw.tree },
    });

    const mystery = resolved.tree.children.find(
      (c: any) => c.type === 'mystery',
    );
    expect(mystery).toBeDefined();
    // substituteVariables has no per-type property spec to consult: it
    // substitutes every string property regardless of the block type's
    // declared schema, so an unknown type's properties are substituted too.
    expect(mystery.properties.x).toBe('Toerbo');
    expect(
      resolved.tree.children.find((c: any) => c.type === 'hero').properties
        .extra,
    ).toBe('keep');
  });

  it('resolves root-level variables for a top node typed "root" and for one typed with the collection name', async () => {
    const { cms } = await setupResolveTreeCMS();
    const { home } = await seed(cms);
    const raw = await treeOf(cms, home.rootId, home.branchId);
    expect(raw.tree.type).toBe('root');

    const resolvedAsRoot = await cms.api.pages.resolveTree({
      body: { rootId: home.rootId, branchId: home.branchId, tree: raw.tree },
    });
    expect(resolvedAsRoot.tree.properties.title).toBe('Toerbo Home');

    const asCollectionName = { ...raw.tree, type: 'pages' };
    const resolvedAsCollectionName = await cms.api.pages.resolveTree({
      body: {
        rootId: home.rootId,
        branchId: home.branchId,
        tree: asCollectionName,
      },
    });
    expect(resolvedAsCollectionName.tree.properties.title).toBe('Toerbo Home');
  });

  describe('scope gate', () => {
    it('rejects an unknown rootId with ROOT_NOT_FOUND', async () => {
      const { cms } = await setupResolveTreeCMS();
      const { home } = await seed(cms);
      const raw = await treeOf(cms, home.rootId, home.branchId);

      await expect(
        cms.api.pages.resolveTree({
          body: {
            rootId: 'root_missing',
            branchId: home.branchId,
            tree: raw.tree,
          },
        }),
      ).rejects.toThrow(/root block not found/i);
    });

    it('rejects a root of another collection with ROOT_NOT_FOUND', async () => {
      const { cms } = await setupResolveTreeCMS();
      const { reusable, home } = await seed(cms);
      const raw = await treeOf(cms, home.rootId, home.branchId);

      await expect(
        cms.api.pages.resolveTree({
          body: {
            rootId: reusable.rootId,
            branchId: reusable.branchId,
            tree: raw.tree,
          },
        }),
      ).rejects.toThrow(/root block not found/i);
    });

    it('rejects a branchId that does not belong to the root with BRANCH_NOT_FOUND', async () => {
      const { cms } = await setupResolveTreeCMS();
      const { about, home } = await seed(cms);
      const raw = await treeOf(cms, home.rootId, home.branchId);

      await expect(
        cms.api.pages.resolveTree({
          body: {
            rootId: home.rootId,
            branchId: about.branchId,
            tree: raw.tree,
          },
        }),
      ).rejects.toThrow(/branch not found/i);
    });
  });

  describe('validation', () => {
    it('rejects a body missing tree', async () => {
      const { cms } = await setupResolveTreeCMS();
      const { home } = await seed(cms);

      await expect(
        cms.api.pages.resolveTree({
          body: { rootId: home.rootId, branchId: home.branchId } as any,
        }),
      ).rejects.toThrow();
    });

    it('rejects a tree node missing children', async () => {
      const { cms } = await setupResolveTreeCMS();
      const { home } = await seed(cms);
      const raw = await treeOf(cms, home.rootId, home.branchId);
      const badTree = { ...raw.tree, children: undefined };

      await expect(
        cms.api.pages.resolveTree({
          body: {
            rootId: home.rootId,
            branchId: home.branchId,
            tree: badTree as any,
          },
        }),
      ).rejects.toThrow();
    });
  });

  it('roundtrips: resolveTree on the stored raw tree matches getBlockTree(raw:false, includeReferencePreviews:true)', async () => {
    const { cms } = await setupResolveTreeCMS();
    const { home } = await seed(cms);
    const raw = await treeOf(cms, home.rootId, home.branchId);

    const resolved = await cms.api.pages.resolveTree({
      body: {
        rootId: home.rootId,
        branchId: home.branchId,
        tree: raw.tree,
        includeReferencePreviews: true,
      },
    });

    const stored = await cms.api.pages.getBlockTree({
      query: {
        rootId: home.rootId,
        branchId: home.branchId,
        raw: false,
        includeReferencePreviews: true,
      },
    });
    const { reconstructed, ...expected } = stored;
    void reconstructed;
    expect(resolved).toEqual(expected);
  });
});

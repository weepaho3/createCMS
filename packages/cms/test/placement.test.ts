import { describe, expect, it } from 'vitest';

import { createCMS } from '../src/index';
import { setupTestDB } from './utils/db';
import { DUMMY_MEDIA_CONFIG } from './utils/fixtures';

/**
 * Collection exercising all three acceptance modes plus the container gate:
 *  - `section.accepts` (whitelist): a section holds ONLY featureItems.
 *  - `root.excludes` (blacklist): the top level holds anything EXCEPT featureItem.
 *  - `allowChildren` (container gate): `paragraph` is a leaf and holds nothing.
 */
const COLLECTIONS = {
  pages: {
    label: 'Pages',
    slug: { enabled: true, root: '/pages' },
    root: {
      properties: { title: { type: 'string', label: 'Title', required: true } },
    },
    blocks: {
      hero: {
        label: 'Hero',
        properties: { headline: { type: 'string', label: 'Headline' } },
      },
      paragraph: {
        label: 'Paragraph',
        // no allowChildren → a leaf, accepts no children
        properties: { text: { type: 'string', label: 'Text' } },
      },
      section: {
        label: 'Section',
        allowChildren: true,
        properties: { heading: { type: 'string', label: 'Heading' } },
      },
      featureItem: {
        label: 'Feature Item',
        properties: { text: { type: 'string', label: 'Text' } },
      },
    },
    structure: {
      section: { accepts: ['featureItem'] }, // whitelist
      root: { excludes: ['featureItem'] }, // blacklist
    },
  },
} as const;

async function setupCMS() {
  const { db } = await setupTestDB();
  const cms = createCMS({
    db,
    media: { ...DUMMY_MEDIA_CONFIG },
    collections: COLLECTIONS,
  });
  return { cms };
}

async function makeRoot(cms: Awaited<ReturnType<typeof setupCMS>>['cms']) {
  return cms.api.pages.createRoot({
    body: { slug: '/', properties: { title: 'Home' } },
  });
}

async function addBlock(
  cms: Awaited<ReturnType<typeof setupCMS>>['cms'],
  root: Awaited<ReturnType<typeof makeRoot>>,
  parentBlockId: string,
  type: 'hero' | 'paragraph' | 'section' | 'featureItem',
  properties: Record<string, unknown> = {},
) {
  return cms.api.pages.createBlock({
    body: {
      rootId: root.rootId,
      branchId: root.branchId,
      parentBlockId,
      type,
      properties,
    },
  });
}

describe('block placement constraints', () => {
  it('blacklist: rejects an excluded child at the root (featureItem at root)', async () => {
    const { cms } = await setupCMS();
    const root = await makeRoot(cms);

    await expect(
      addBlock(cms, root, root.rootId, 'featureItem', { text: 'orphan' }),
    ).rejects.toThrow(/not allowed inside/i);
  });

  it('blacklist: allows a non-excluded child at the root (hero at root)', async () => {
    const { cms } = await setupCMS();
    const root = await makeRoot(cms);

    const hero = await addBlock(cms, root, root.rootId, 'hero', {
      headline: 'Hi',
    });
    expect(hero.blockId).toBeTruthy();
  });

  it('whitelist: allows a listed child (featureItem in section)', async () => {
    const { cms } = await setupCMS();
    const root = await makeRoot(cms);
    const section = await addBlock(cms, root, root.rootId, 'section', {
      heading: 'Features',
    });

    const item = await addBlock(cms, root, section.blockId, 'featureItem', {
      text: 'fast',
    });
    expect(item.blockId).toBeTruthy();
  });

  it('whitelist: rejects an unlisted child (paragraph in section)', async () => {
    const { cms } = await setupCMS();
    const root = await makeRoot(cms);
    const section = await addBlock(cms, root, root.rootId, 'section', {
      heading: 'Features',
    });

    await expect(
      addBlock(cms, root, section.blockId, 'paragraph', { text: 'nope' }),
    ).rejects.toThrow(/accepts only/i);
  });

  it('container gate: rejects any child dropped into a non-container (paragraph)', async () => {
    const { cms } = await setupCMS();
    const root = await makeRoot(cms);
    const para = await addBlock(cms, root, root.rootId, 'paragraph', {
      text: 'leaf',
    });

    await expect(
      addBlock(cms, root, para.blockId, 'hero', { headline: 'x' }),
    ).rejects.toThrow(/does not accept child blocks/i);
  });

  it('enforces placement on moveBlock (cannot move a featureItem out to the root)', async () => {
    const { cms } = await setupCMS();
    const root = await makeRoot(cms);
    const section = await addBlock(cms, root, root.rootId, 'section', {
      heading: 'Features',
    });
    const item = await addBlock(cms, root, section.blockId, 'featureItem', {
      text: 'fast',
    });

    await expect(
      cms.api.pages.moveBlock({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          blockId: item.blockId,
          newParentBlockId: root.rootId,
          newIndex: 0,
        },
      }),
    ).rejects.toThrow(/not allowed inside/i);
  });
});

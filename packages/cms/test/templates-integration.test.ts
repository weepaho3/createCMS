import { describe, expect, it } from 'vitest';

import { setupTestCMS } from './utils/cms';

type Cms = Awaited<ReturnType<typeof setupTestCMS>>['cms'];

// `signupForm` has a required `cta` (caller must provide) and an OPTIONAL
// `trackingId` — templates seed optional properties the caller leaves unset.
async function trackingId(
  cms: Cms,
  rootId: string,
  branchId: string,
): Promise<unknown> {
  const tree = await cms.api.pages.getBlockTree({
    query: { rootId, branchId },
  });
  return (tree.tree.children[0]?.properties as { trackingId?: unknown })
    ?.trackingId;
}

async function rootWithForm(cms: Cms, properties: Record<string, string>) {
  const root = await cms.api.pages.createRoot({
    body: { slug: '/', properties: { title: 'Home' } },
  });
  await cms.api.pages.createBlock({
    body: {
      rootId: root.rootId,
      branchId: root.branchId,
      parentBlockId: root.rootId,
      type: 'signupForm',
      properties,
    },
  });
  return root;
}

describe('templates — server-side application in createBlock', () => {
  it('seeds an optional property the caller did not provide', async () => {
    const { cms } = await setupTestCMS();
    await cms.api.templates.createTemplate({
      body: {
        collection: 'pages',
        blockType: 'signupForm',
        propertyKey: 'trackingId',
        template: 'TPL-DEFAULT',
      },
    });

    // Provide only the required `cta`; `trackingId` is left to the template.
    const root = await rootWithForm(cms, { cta: 'Sign up' });
    expect(await trackingId(cms, root.rootId, root.branchId)).toBe(
      'TPL-DEFAULT',
    );
  });

  it('caller-provided value wins over the template default', async () => {
    const { cms } = await setupTestCMS();
    await cms.api.templates.createTemplate({
      body: {
        collection: 'pages',
        blockType: 'signupForm',
        propertyKey: 'trackingId',
        template: 'TPL-DEFAULT',
      },
    });

    const root = await rootWithForm(cms, {
      cta: 'Sign up',
      trackingId: 'explicit-id',
    });
    expect(await trackingId(cms, root.rootId, root.branchId)).toBe(
      'explicit-id',
    );
  });

  it('applies nothing when no template exists for the block type', async () => {
    const { cms } = await setupTestCMS();
    const root = await rootWithForm(cms, { cta: 'Sign up' });
    expect(await trackingId(cms, root.rootId, root.branchId)).toBeUndefined();
  });

  it('seeds the RAW template so embedded {{variables}} stay live', async () => {
    const { cms } = await setupTestCMS();
    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });
    await cms.api.templates.createTemplate({
      body: {
        collection: 'pages',
        blockType: 'signupForm',
        propertyKey: 'trackingId',
        template: 'id-{{brandName}}',
      },
    });

    const root = await rootWithForm(cms, { cta: 'Sign up' });
    // Resolved at read time, not frozen at create time.
    expect(await trackingId(cms, root.rootId, root.branchId)).toBe('id-Toerbo');

    // Changing the variable propagates to the already-created block.
    await cms.api.variables.updateVariable({
      body: { key: 'brandName', value: 'Reblge' },
    });
    expect(await trackingId(cms, root.rootId, root.branchId)).toBe('id-Reblge');
  });
});

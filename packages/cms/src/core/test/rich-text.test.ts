import { eq } from 'drizzle-orm';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

import type { RichTextDoc, RichTextNode } from '../rich-text/types';

import { blockVersions } from '../../schema';
import { setupTestCMS } from '../../test-utils/cms';
import { TEST_COLLECTIONS } from '../../test-utils/fixtures';
import { publishApprovedBranch } from '../../test-utils/helpers';
import { migrateRichText } from '../admin/migrate-rich-text';

const text = (value: string, marks?: RichTextNode['marks']): RichTextNode =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const doc = (...content: RichTextNode[]): RichTextDoc => ({
  type: 'doc',
  content: [{ type: 'paragraph', content }],
});

/** The test drives the API with loosely typed bodies and reads. */
const loose = (cms: unknown) => cms as { api: any };

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: { body?: { code?: string }; code?: string }) =>
      error.body?.code ?? error.code,
  );

async function page(cms: { api: any }, slug = 'p') {
  return cms.api.pages.createRoot({
    body: { slug, properties: { title: 'Page' } },
  });
}

async function paragraph(
  cms: { api: any },
  root: { rootId: string; branchId: string },
  properties: Record<string, unknown>,
) {
  return cms.api.pages.createBlock({
    body: {
      rootId: root.rootId,
      branchId: root.branchId,
      parentBlockId: root.rootId,
      type: 'paragraph',
      properties: { text: 'p', ...properties },
    },
  });
}

describe('richText on the write paths', () => {
  it('stores valid JSON and rejects HTML strings', async () => {
    const cms = loose((await setupTestCMS()).cms);
    const root = await page(cms);
    const block = await paragraph(cms, root, {
      body: doc(text('Hello '), text('bold', [{ type: 'bold' }])),
    });
    const tree = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId, raw: true },
    });
    expect(tree.tree.children[0].properties.body).toEqual(
      doc(text('Hello '), text('bold', [{ type: 'bold' }])),
    );
    expect(
      await codeOf(
        cms.api.pages.updateBlock({
          body: {
            rootId: root.rootId,
            branchId: root.branchId,
            blockId: block.blockId,
            type: 'paragraph',
            properties: { body: '<p>Hello</p>' },
          },
        }),
      ),
    ).toBe('VALIDATION_ERROR');
  });

  it('rejects formatting the property does not allow with RICH_TEXT_INVALID', async () => {
    const cms = loose((await setupTestCMS()).cms);
    const root = await page(cms);
    expect(
      await codeOf(
        paragraph(cms, root, {
          body: doc(text('x', [{ type: 'underline' }])),
        }),
      ),
    ).toBe('RICH_TEXT_INVALID');
    expect(
      await codeOf(
        paragraph(cms, root, {
          body: doc(
            text('x', [
              { type: 'link', attrs: { href: 'javascript:alert(1)' } },
            ]),
          ),
        }),
      ),
    ).toBe('RICH_TEXT_INVALID');
  });

  it('updateBlocks: HTML is a TYPE_MISMATCH, a forbidden mark RICH_TEXT_INVALID', async () => {
    const cms = loose((await setupTestCMS()).cms);
    const root = await page(cms);
    const block = await paragraph(cms, root, { body: doc(text('a')) });
    const tree = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId, raw: true },
    });
    const withBody = (body: unknown) => ({
      ...tree.tree,
      children: [
        {
          ...tree.tree.children[0],
          blockId: block.blockId,
          properties: { ...tree.tree.children[0].properties, body },
        },
      ],
    });
    const save = (body: unknown) =>
      cms.api.pages.updateBlocks({
        body: {
          rootId: root.rootId,
          branchId: root.branchId,
          tree: withBody(body),
        },
      });
    expect(await codeOf(save('<p>html</p>'))).toBe('TYPE_MISMATCH');
    expect(await codeOf(save(doc(text('x', [{ type: 'code' }]))))).toBe(
      'RICH_TEXT_INVALID',
    );
    expect(await codeOf(save(doc(text('fine'))))).toBeNull();
  });
});

describe('richText on the read paths', () => {
  it('substitutes variables in text nodes and records their usage', async () => {
    const cms = loose((await setupTestCMS()).cms);
    await cms.api.variables.createVariable({
      body: { key: 'company', value: 'Acme' },
    });
    const root = await page(cms);
    await paragraph(cms, root, {
      body: doc(text('Hi {{company}} and {{unknown}}')),
      notes: [doc(text('{{company}} note'))],
    });
    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });
    const content = await cms.api.pages.getPublishedContent({
      query: { rootId: root.rootId },
    });
    const props = (content.variants as any[])[0].tree.children[0].properties;
    expect(props.body).toEqual(doc(text('Hi Acme and {{unknown}}')));
    expect(props.notes).toEqual([doc(text('Acme note'))]);
    const usages = await cms.api.variables.getVariableUsages({
      query: { key: 'company' },
    });
    expect(usages.blockUsageCount).toBeGreaterThan(0);
  });

  it('resolves internal link marks to the current path, a gone target to null', async () => {
    const cms = loose((await setupTestCMS()).cms);
    const about = await page(cms, 'about');
    await cms.api.pages.publishBranch({
      body: { rootId: about.rootId, branchId: about.branchId },
    });
    const home = await page(cms, 'home');
    const internal = {
      link: { kind: 'internal', rootId: about.rootId, collection: 'pages' },
    };
    const gone = {
      link: { kind: 'internal', rootId: 'rot_missing', collection: 'pages' },
    };
    await paragraph(cms, home, {
      body: doc(
        text('about', [{ type: 'link', attrs: internal }]),
        text(' gone', [{ type: 'link', attrs: gone }]),
      ),
    });
    const tree = await cms.api.pages.getBlockTree({
      query: { rootId: home.rootId, branchId: home.branchId, raw: false },
    });
    const marks = tree.tree.children[0].properties.body.content[0].content.map(
      (node: RichTextNode) => node.marks?.[0]?.attrs?.resolved,
    );
    expect(marks[0]).toEqual({ href: expect.stringContaining('about') });
    expect(marks[1]).toEqual({ href: null });
    const raw = await cms.api.pages.getBlockTree({
      query: { rootId: home.rootId, branchId: home.branchId, raw: true },
    });
    expect(
      raw.tree.children[0].properties.body.content[0].content[0].marks[0].attrs,
    ).toEqual(internal);
  });

  it('indexes the plain text of richText for search', async () => {
    const cms = loose((await setupTestCMS()).cms);
    const root = await page(cms);
    await paragraph(cms, root, {
      body: doc(
        text('Findable '),
        text('Zugspitzwanderung', [{ type: 'bold' }]),
      ),
    });
    await cms.api.admin.reindexSearch({ body: {} });
    const result = await cms.api.search.query({
      query: { search: 'Zugspitzwanderung' },
    });
    expect(result.results.some((r: any) => r.entityId === root.rootId)).toBe(
      true,
    );
  });
});

describe('templates on richText targets', () => {
  it('seeds a rich text value, one paragraph per line, variables kept', async () => {
    const cms = loose((await setupTestCMS()).cms);
    await cms.api.templates.createTemplate({
      body: {
        collection: 'pages',
        blockType: 'paragraph',
        propertyKey: 'body',
        template: 'Hello {{company}}\nSecond line',
      },
    });
    const root = await page(cms);
    await paragraph(cms, root, {});
    const tree = await cms.api.pages.getBlockTree({
      query: { rootId: root.rootId, branchId: root.branchId, raw: true },
    });
    expect(tree.tree.children[0].properties.body).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Hello {{company}}' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second line' }] },
      ],
    });
  });
});

describe('migrateRichText', () => {
  const window = new Window();
  const domParser = (html: string) =>
    new window.DOMParser().parseFromString(html, 'text/html') as never;

  it('converts stored HTML, reports losses, and a second run changes nothing', async () => {
    const setup = await setupTestCMS();
    const cms = loose(setup.cms);
    const db = setup.db;
    const root = await page(cms);
    const block = await paragraph(cms, root, { body: doc(text('x')) });
    // Write HTML straight into the stored version, as older releases did.
    const [version] = await db
      .select()
      .from(blockVersions)
      .where(eq(blockVersions.blockId, block.blockId));
    await db
      .update(blockVersions)
      .set({
        properties: {
          ...version!.properties,
          body: '<p>Hi <b>there</b> <u>u</u><script>x()</script></p>',
          notes: ['<p>one</p>', doc(text('two'))],
        },
      })
      .where(eq(blockVersions.id, version!.id));

    const dry = await migrateRichText(db, TEST_COLLECTIONS as never, {
      dryRun: true,
      domParser,
    });
    expect(dry.converted).toBe(2);
    expect(dry.lossy).toHaveLength(1);
    expect(dry.lossy[0]).toMatchObject({
      blockVersionId: version!.id,
      property: 'body',
      loss: { tags: { script: 1 }, marks: { underline: 1 } },
    });
    const [still] = await db
      .select()
      .from(blockVersions)
      .where(eq(blockVersions.id, version!.id));
    expect(typeof still!.properties.body).toBe('string');

    const run = await migrateRichText(db, TEST_COLLECTIONS as never, {
      domParser,
      batchSize: 1,
    });
    expect(run.converted).toBe(2);
    const [after] = await db
      .select()
      .from(blockVersions)
      .where(eq(blockVersions.id, version!.id));
    expect(after!.properties.body).toEqual(
      doc(text('Hi '), text('there', [{ type: 'bold' }]), text(' u')),
    );
    expect(after!.properties.notes).toEqual([
      doc(text('one')),
      doc(text('two')),
    ]);

    const again = await migrateRichText(db, TEST_COLLECTIONS as never, {
      domParser,
    });
    expect(again.converted).toBe(0);
    expect(again.failed).toEqual([]);
  });

  it('stops after maxBatches and continues from the cursor', async () => {
    const setup = await setupTestCMS();
    const cms = loose(setup.cms);
    const db = setup.db;
    const root = await page(cms);
    await paragraph(cms, root, { body: doc(text('a')) });
    await paragraph(cms, root, { body: doc(text('b')) });
    const first = await migrateRichText(db, TEST_COLLECTIONS as never, {
      domParser,
      batchSize: 1,
      maxBatches: 1,
    });
    expect(first.nextCursor).not.toBeNull();
    const rest = await migrateRichText(db, TEST_COLLECTIONS as never, {
      domParser,
      cursor: first.nextCursor,
    });
    expect(rest.nextCursor).toBeNull();
    expect(first.scanned + rest.scanned).toBeGreaterThan(1);
  });
});

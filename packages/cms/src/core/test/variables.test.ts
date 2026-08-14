import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { BlockTreeNode } from '../blocks/reconstruct-snapshot';

import { contentUsages, templateVariableUsages } from '../../schema';
import { setupTestCMS } from '../../test-utils/cms';
import { publishApprovedBranch } from '../../test-utils/helpers';
import {
  extractVariableKeys,
  extractVariableKeysFromProperties,
  substituteVariables,
  resolveTemplateString,
} from '../variables';

// ============================================================================
// Unit tests for variable utility functions
// ============================================================================

describe('extractVariableKeys', () => {
  it('extracts variable keys from a string', () => {
    expect(extractVariableKeys('Hello {{brandName}}!')).toEqual(['brandName']);
  });

  it('extracts multiple unique keys', () => {
    expect(
      extractVariableKeys('{{brandName}} - {{tagline}} - {{brandName}}'),
    ).toEqual(['brandName', 'tagline']);
  });

  it('returns empty array for strings without variables', () => {
    expect(extractVariableKeys('No variables here')).toEqual([]);
  });

  it('handles empty string', () => {
    expect(extractVariableKeys('')).toEqual([]);
  });
});

describe('extractVariableKeysFromProperties', () => {
  it('extracts keys from string properties only', () => {
    const result = extractVariableKeysFromProperties({
      title: '{{brandName}} Home',
      count: 42,
      active: true,
      subtitle: '{{tagline}}',
    });
    expect(result.get('title')).toEqual(['brandName']);
    expect(result.get('subtitle')).toEqual(['tagline']);
    expect(result.has('count')).toBe(false);
    expect(result.has('active')).toBe(false);
  });

  it('returns empty map when no variables found', () => {
    const result = extractVariableKeysFromProperties({
      title: 'Static title',
      count: 5,
    });
    expect(result.size).toBe(0);
  });
});

describe('substituteVariables', () => {
  it('replaces variables in tree node properties', () => {
    const tree: BlockTreeNode = {
      blockId: 'root',
      type: 'page',
      properties: { title: '{{brandName}} Home', description: 'Welcome' },
      children: [],
    };

    const vars = new Map([['brandName', 'Toerbo']]);
    substituteVariables(tree, vars);

    expect(tree.properties.title).toBe('Toerbo Home');
    expect(tree.properties.description).toBe('Welcome');
  });

  it('replaces variables recursively in children', () => {
    const tree: BlockTreeNode = {
      blockId: 'root',
      type: 'page',
      properties: { title: '{{brandName}}' },
      children: [
        {
          blockId: 'child1',
          type: 'hero',
          properties: {
            headline: '{{brandName}} is great',
            sub: '{{tagline}}',
          },
          children: [],
        },
      ],
    };

    const vars = new Map([
      ['brandName', 'Toerbo'],
      ['tagline', 'Build fast'],
    ]);
    substituteVariables(tree, vars);

    expect(tree.properties.title).toBe('Toerbo');
    expect(tree.children[0].properties.headline).toBe('Toerbo is great');
    expect(tree.children[0].properties.sub).toBe('Build fast');
  });

  it('does nothing when vars map is empty', () => {
    const tree: BlockTreeNode = {
      blockId: 'root',
      type: 'page',
      properties: { title: '{{brandName}}' },
      children: [],
    };

    substituteVariables(tree, new Map());
    expect(tree.properties.title).toBe('{{brandName}}');
  });
});

describe('resolveTemplateString', () => {
  it('resolves template with variables', () => {
    const vars = new Map([['brandName', 'Toerbo']]);
    expect(resolveTemplateString("{{brandName}}'s Seite", vars)).toBe(
      "Toerbo's Seite",
    );
  });

  it('leaves unresolved variables', () => {
    expect(resolveTemplateString('{{missing}}', new Map())).toBe('{{missing}}');
  });
});

// ============================================================================
// Integration tests with CMS instance
// ============================================================================

describe('Variable CRUD endpoints', () => {
  it('creates, reads, updates, and deletes a variable', async () => {
    const { cms } = await setupTestCMS();

    const { variable: created } = await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo', description: 'Brand name' },
    });
    expect(created.key).toBe('brandName');
    expect(created.value).toBe('Toerbo');

    const { variables: allVars } = await cms.api.variables.list({ query: {} });
    expect(allVars).toHaveLength(1);
    expect(allVars[0].key).toBe('brandName');

    const { variable: fetched } = await cms.api.variables.getVariable({
      query: { key: 'brandName' },
    });
    expect(fetched.value).toBe('Toerbo');

    const { variable: updated } = await cms.api.variables.updateVariable({
      body: { key: 'brandName', value: 'NewBrand' },
    });
    expect(updated.value).toBe('NewBrand');

    await cms.api.variables.deleteVariable({ body: { key: 'brandName' } });
    const { variables: afterDelete } = await cms.api.variables.list({
      query: {},
    });
    expect(afterDelete).toHaveLength(0);
  });

  it('rejects duplicate variable keys', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    await expect(
      cms.api.variables.createVariable({
        body: { key: 'brandName', value: 'Other' },
      }),
    ).rejects.toThrow();
  });
});

describe('Variable delete protection', () => {
  it('prevents deletion of a variable used in block properties', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    await cms.api.pages.createRoot({
      body: {
        slug: '/',
        properties: { title: '{{brandName}} Home' },
      },
    });

    await expect(
      cms.api.variables.deleteVariable({ body: { key: 'brandName' } }),
    ).rejects.toThrow();

    const usages = await cms.api.variables.getVariableUsages({
      query: { key: 'brandName' },
    });
    expect(usages.blockUsageCount).toBeGreaterThan(0);
  });

  it('ignores usages from archived roots so they do not block deletion', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: '{{brandName}} Home' } },
    });

    // Archive the root — its variable usages must no longer count as "in use".
    await cms.api.pages.archiveRoot({ body: { rootId: root.rootId } });

    const usages = await cms.api.variables.getVariableUsages({
      query: { key: 'brandName' },
    });
    expect(usages.blockUsageCount).toBe(0);

    // ...so the variable is now deletable (no false-positive VARIABLE_IN_USE).
    await cms.api.variables.deleteVariable({ body: { key: 'brandName' } });
  });
});

describe('Variable substitution in getBlockTree', () => {
  it('substitutes variables in block tree by default', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    const root = await cms.api.pages.createRoot({
      body: {
        slug: '/',
        properties: { title: '{{brandName}} Home' },
      },
    });

    const { tree } = await cms.api.pages.getBlockTree({
      query: {
        rootId: root.rootId,
        branchId: root.branchId,
      },
    });

    expect((tree.properties as { title?: unknown }).title).toBe('Toerbo Home');
  });

  it('returns raw variables when raw=true', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    const root = await cms.api.pages.createRoot({
      body: {
        slug: '/',
        properties: { title: '{{brandName}} Home' },
      },
    });

    const { tree } = await cms.api.pages.getBlockTree({
      query: {
        rootId: root.rootId,
        branchId: root.branchId,
        raw: true,
      },
    });

    expect((tree.properties as { title?: unknown }).title).toBe(
      '{{brandName}} Home',
    );
  });
});

describe('Variable substitution in getPublishedContent', () => {
  it('substitutes variables in published content', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    const root = await cms.api.pages.createRoot({
      body: {
        slug: '/',
        properties: { title: '{{brandName}} Home' },
      },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    const content = await cms.api.pages.getPublishedContent({
      query: { rootId: root.rootId },
    });

    const variants = content.variants as any[];
    expect(variants[0].tree.properties.title).toBe('Toerbo Home');
  });

  it('returns raw content when raw=true', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    const root = await cms.api.pages.createRoot({
      body: {
        slug: '/',
        properties: { title: '{{brandName}} Home' },
      },
    });

    await publishApprovedBranch(cms, {
      rootId: root.rootId,
      branchId: root.branchId,
      publishedBy: 'user-1',
    });

    const content = await cms.api.pages.getPublishedContent({
      query: { rootId: root.rootId, raw: true },
    });

    const variants = content.variants as any[];
    expect(variants[0].tree.properties.title).toBe('{{brandName}} Home');
  });
});

describe('Variable usage sync on block operations', () => {
  it('syncs usages when creating a block with variables', async () => {
    const { cms, db } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    const root = await cms.api.pages.createRoot({
      body: {
        slug: '/',
        properties: { title: '{{brandName}} Home' },
      },
    });

    const usages = await db
      .select()
      .from(contentUsages)
      .where(
        and(
          eq(contentUsages.targetKind, 'variable'),
          eq(contentUsages.rootId, root.rootId),
        ),
      );

    expect(usages.length).toBeGreaterThan(0);
    expect(usages[0].targetKey).toBe('brandName');
    expect(usages[0].propertyKey).toBe('title');
  });

  it('updates usages when updating a block', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });
    await cms.api.variables.createVariable({
      body: { key: 'tagline', value: 'Build fast' },
    });

    const root = await cms.api.pages.createRoot({
      body: {
        slug: '/',
        properties: { title: '{{brandName}} Home' },
      },
    });

    await cms.api.pages.updateRoot({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        properties: { title: '{{tagline}} Page' },
      },
    });

    // Usage is decided against the LIVE branch head: after the edit the head
    // block uses {{tagline}}, not {{brandName}}. The superseded version's row
    // lingers in the append-only table but no longer counts as live.
    const tagline = await cms.api.variables.getVariableUsages({
      query: { key: 'tagline' },
    });
    expect(tagline.blockUsageCount).toBe(1);
    expect(tagline.blockUsages[0].blockId).toBe(root.rootId);

    const brand = await cms.api.variables.getVariableUsages({
      query: { key: 'brandName' },
    });
    expect(brand.blockUsageCount).toBe(0);
  });

  it('removes usages when deleting a block', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    const root = await cms.api.pages.createRoot({
      body: {
        slug: '/',
        properties: { title: 'Home' },
      },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: '{{brandName}} content' },
      },
    });

    const beforeDelete = await cms.api.variables.getVariableUsages({
      query: { key: 'brandName' },
    });
    expect(beforeDelete.blockUsageCount).toBeGreaterThan(0);

    await cms.api.pages.deleteBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: block.blockId,
      },
    });

    // The delete writes a tombstone version (deleted=true) at the head; it is
    // excluded from live usage, so the variable is no longer in use.
    const afterDelete = await cms.api.variables.getVariableUsages({
      query: { key: 'brandName' },
    });
    expect(afterDelete.blockUsageCount).toBe(0);
  });
});

// ============================================================================
// Variable description tests
// ============================================================================

describe('Variable description', () => {
  it('persists description on create', async () => {
    const { cms } = await setupTestCMS();

    const { variable } = await cms.api.variables.createVariable({
      body: {
        key: 'brandName',
        value: 'Toerbo',
        description: 'The primary brand name used across the site',
      },
    });

    expect(variable.description).toBe(
      'The primary brand name used across the site',
    );
  });

  it('defaults description to null when omitted', async () => {
    const { cms } = await setupTestCMS();

    const { variable } = await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    expect(variable.description).toBeNull();
  });

  it('updates description independently of value', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    const { variable } = await cms.api.variables.updateVariable({
      body: { key: 'brandName', description: 'Updated description' },
    });

    expect(variable.description).toBe('Updated description');
    expect(variable.value).toBe('Toerbo');
  });

  it('returns description in list and get endpoints', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: {
        key: 'brandName',
        value: 'Toerbo',
        description: 'Brand name',
      },
    });

    const { variables: allVars } = await cms.api.variables.list({ query: {} });
    expect(allVars[0].description).toBe('Brand name');

    const { variable } = await cms.api.variables.getVariable({
      query: { key: 'brandName' },
    });
    expect(variable.description).toBe('Brand name');
  });
});

// ============================================================================
// Variable usage sync in updateBlocks (batch update)
// ============================================================================

describe('Variable usage sync in updateBlocks', () => {
  it('syncs usages for updated blocks in a batch', async () => {
    const { cms, db } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: 'static' },
      },
    });

    await cms.api.pages.updateBlocks({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        tree: {
          blockId: root.rootId,
          type: 'pages',
          properties: { title: 'Home' },
          children: [
            {
              blockId: block.blockId,
              type: 'paragraph',
              properties: { text: '{{brandName}} content' },
              children: [],
            },
          ],
        },
      },
    });

    const usages = await db
      .select()
      .from(contentUsages)
      .where(
        and(
          eq(contentUsages.targetKind, 'variable'),
          eq(contentUsages.blockId, block.blockId),
        ),
      );

    expect(usages.length).toBe(1);
    expect(usages[0].targetKey).toBe('brandName');
    expect(usages[0].propertyKey).toBe('text');
  });

  it('removes usages for deleted blocks in a batch', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });

    await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: '{{brandName}} content' },
      },
    });

    const usagesBefore = await cms.api.variables.getVariableUsages({
      query: { key: 'brandName' },
    });
    expect(usagesBefore.blockUsageCount).toBe(1);

    await cms.api.pages.updateBlocks({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        tree: {
          blockId: root.rootId,
          type: 'pages',
          properties: { title: 'Home' },
          children: [],
        },
      },
    });

    // The batch dropped the block (tombstone at head) -> no live usage left.
    const usagesAfter = await cms.api.variables.getVariableUsages({
      query: { key: 'brandName' },
    });
    expect(usagesAfter.blockUsageCount).toBe(0);
  });

  it('syncs usages for newly created blocks in a batch', async () => {
    const { newId } = await import('../../utils/nanoid');
    const { cms, db } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'tagline', value: 'Build fast' },
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });

    const newBlockId = newId('block');

    await cms.api.pages.updateBlocks({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        tree: {
          blockId: root.rootId,
          type: 'pages',
          properties: { title: 'Home' },
          children: [
            {
              blockId: newBlockId,
              type: 'paragraph',
              properties: { text: '{{tagline}} here' },
              children: [],
            },
          ],
        },
      },
    });

    const usages = await db
      .select()
      .from(contentUsages)
      .where(
        and(
          eq(contentUsages.targetKind, 'variable'),
          eq(contentUsages.blockId, newBlockId),
        ),
      );

    expect(usages.length).toBe(1);
    expect(usages[0].targetKey).toBe('tagline');
  });
});

// ============================================================================
// Variable usage sync in duplicateBlock
// ============================================================================

describe('Variable usage sync in duplicateBlock', () => {
  it('syncs usages for duplicated child blocks', async () => {
    const { cms, db } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    const root = await cms.api.pages.createRoot({
      body: { slug: '/', properties: { title: 'Home' } },
    });

    const block = await cms.api.pages.createBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        parentBlockId: root.rootId,
        type: 'paragraph',
        properties: { text: '{{brandName}} content' },
      },
    });

    const result = await cms.api.pages.duplicateBlock({
      body: {
        rootId: root.rootId,
        branchId: root.branchId,
        blockId: block.blockId,
        targetParentBlockId: root.rootId,
      },
    });

    const duplicatedBlockId = (result as any).blockId;
    const usages = await db
      .select()
      .from(contentUsages)
      .where(
        and(
          eq(contentUsages.targetKind, 'variable'),
          eq(contentUsages.blockId, duplicatedBlockId),
        ),
      );

    expect(usages.length).toBe(1);
    expect(usages[0].targetKey).toBe('brandName');
    expect(usages[0].propertyKey).toBe('text');
  });
});

// ============================================================================
// Template CRUD tests
// ============================================================================

describe('Template CRUD endpoints', () => {
  it('creates, reads, updates, and deletes a template', async () => {
    const { cms } = await setupTestCMS();

    const { template: created } = await cms.api.templates.createTemplate({
      body: {
        collection: 'pages',
        blockType: 'paragraph',
        propertyKey: 'text',
        template: "{{brandName}}'s content",
        description: 'Default paragraph text',
      },
    });
    expect(created.collection).toBe('pages');
    expect(created.template).toBe("{{brandName}}'s content");

    const { templates: allTemplates } = await cms.api.templates.list({
      query: { collection: 'pages' },
    });
    expect(allTemplates).toHaveLength(1);

    const { template: fetched } = await cms.api.templates.getTemplate({
      query: { templateId: created.id },
    });
    expect(fetched.template).toBe("{{brandName}}'s content");

    const { template: updated } = await cms.api.templates.updateTemplate({
      body: { templateId: created.id, template: 'Updated {{brandName}}' },
    });
    expect(updated.template).toBe('Updated {{brandName}}');

    await cms.api.templates.deleteTemplate({
      body: { templateId: created.id },
    });
    const { templates: afterDelete } = await cms.api.templates.list({});
    expect(afterDelete).toHaveLength(0);
  });

  it('rejects duplicate template for same collection/block/property', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.templates.createTemplate({
      body: {
        collection: 'pages',
        blockType: 'paragraph',
        propertyKey: 'text',
        template: 'First',
      },
    });

    await expect(
      cms.api.templates.createTemplate({
        body: {
          collection: 'pages',
          blockType: 'paragraph',
          propertyKey: 'text',
          template: 'Second',
        },
      }),
    ).rejects.toThrow();
  });

  it('rejects a template for a non-text or non-existent property', async () => {
    const { cms } = await setupTestCMS();

    // `image.src` is an `image` property (expects an asset id), not text.
    await expect(
      cms.api.templates.createTemplate({
        body: {
          collection: 'pages',
          blockType: 'image',
          propertyKey: 'src',
          template: 'not-an-image',
        },
      }),
    ).rejects.toThrow(/text property/i);

    // A property that does not exist on the block type.
    await expect(
      cms.api.templates.createTemplate({
        body: {
          collection: 'pages',
          blockType: 'paragraph',
          propertyKey: 'doesNotExist',
          template: 'x',
        },
      }),
    ).rejects.toThrow(/text property/i);

    // A `string` text property IS accepted.
    const { template } = await cms.api.templates.createTemplate({
      body: {
        collection: 'pages',
        blockType: 'image',
        propertyKey: 'alt',
        template: 'Default alt text',
      },
    });
    expect(template.propertyKey).toBe('alt');
  });
});

describe('Template resolve endpoint', () => {
  it('resolves a template string with current variables', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    const result = await cms.api.templates.resolveTemplate({
      query: { template: "{{brandName}}'s Seite" },
    });

    expect(result.resolved).toBe("Toerbo's Seite");
  });
});

describe('Template defaults endpoint', () => {
  it('returns resolved defaults for a block type', async () => {
    const { cms } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    await cms.api.templates.createTemplate({
      body: {
        collection: 'pages',
        blockType: 'paragraph',
        propertyKey: 'text',
        template: "Welcome to {{brandName}}'s page",
      },
    });

    const result = await cms.api.templates.getTemplateDefaults({
      query: { collection: 'pages', blockType: 'paragraph' },
    });

    expect(result.defaults).toEqual({
      text: "Welcome to Toerbo's page",
    });
  });
});

describe('Template variable usage tracking', () => {
  it('tracks variable usages in templates for delete protection', async () => {
    const { cms, db } = await setupTestCMS();

    await cms.api.variables.createVariable({
      body: { key: 'brandName', value: 'Toerbo' },
    });

    const { template } = await cms.api.templates.createTemplate({
      body: {
        collection: 'pages',
        blockType: 'paragraph',
        propertyKey: 'text',
        template: '{{brandName}} content',
      },
    });

    const usages = await db
      .select()
      .from(templateVariableUsages)
      .where(eq(templateVariableUsages.templateId, template.id));

    expect(usages.length).toBe(1);
    expect(usages[0].variableKey).toBe('brandName');

    await expect(
      cms.api.variables.deleteVariable({ body: { key: 'brandName' } }),
    ).rejects.toThrow();
  });
});

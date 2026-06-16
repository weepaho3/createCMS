import { and, eq } from 'drizzle-orm';
import * as z from 'zod';

import type { CMSProcedureCtx } from '../types';

import { newId } from '../../utils/nanoid';
import { templates, templateVariableUsages } from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError } from '../errors';
import {
  extractVariableKeys,
  loadVariables,
  resolveTemplateString,
} from '../variables';

const META = { scope: 'system' as const, permissionResource: 'templates' };

async function syncTemplateVariableUsages(
  tx: any,
  templateId: string,
  templateStr: string,
) {
  const varKeys = extractVariableKeys(templateStr);

  await tx
    .delete(templateVariableUsages)
    .where(eq(templateVariableUsages.templateId, templateId));

  if (varKeys.length > 0) {
    await tx
      .insert(templateVariableUsages)
      .values(
        varKeys.map((varKey) => ({
          id: newId('tplVarUsage'),
          variableKey: varKey,
          templateId,
        })),
      )
      .onConflictDoNothing();
  }
}

export function createTemplateEndpoints(cmsCtx: CMSProcedureCtx) {
  const { db } = cmsCtx;

  return {
    /**
     * Lists all templates, optionally filtered by collection and blockType.
     * @param collection - Filter templates by collection name.
     * @param blockType - Filter templates by block type.
     * @returns The list of matching template records.
     * @example await cmsClient.templates.listTemplates({ collection: 'pages', blockType: 'hero' })
     */
    listTemplates: createCMSEndpoint(
      '/templates',
      {
        method: 'GET',
        query: z
          .object({
            collection: z.string().optional(),
            blockType: z.string().optional(),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                collection?: string;
                blockType?: string;
              },
            },
          },
          { ...META, operation: 'read' },
        ),
      },
      async (ctx) => {
        const { collection, blockType } = ctx.query ?? {};

        const conditions = [];
        if (collection) conditions.push(eq(templates.collection, collection));
        if (blockType) conditions.push(eq(templates.blockType, blockType));

        const rows =
          conditions.length > 0
            ? await db
                .select()
                .from(templates)
                .where(and(...conditions))
                .orderBy(templates.collection, templates.blockType)
            : await db
                .select()
                .from(templates)
                .orderBy(templates.collection, templates.blockType);

        return { templates: rows };
      },
    ),

    /**
     * Retrieves a single template by ID.
     * @param id - The template ID.
     * @returns The template record.
     * @throws TEMPLATE_NOT_FOUND if the template does not exist.
     * @example await cmsClient.templates.getTemplate({ id: 'tpl_abc123' })
     */
    getTemplate: createCMSEndpoint(
      '/templates/get',
      {
        method: 'GET',
        query: z.object({ id: z.string() }),
        metadata: cmsMeta(
          { $Infer: { query: {} as { id: string } } },
          { ...META, operation: 'read' },
        ),
      },
      async (ctx) => {
        const [template] = await db
          .select()
          .from(templates)
          .where(eq(templates.id, ctx.query.id));
        if (!template) throw new CMSError('TEMPLATE_NOT_FOUND');
        return { template };
      },
    ),

    /**
     * Creates a new template with an optional description, and tracks variable usages in the template string.
     * @param collection - The collection name.
     * @param blockType - The block type.
     * @param propertyKey - The property key this template applies to.
     * @param template - The template string (may include {{variableKey}} placeholders).
     * @param description - Optional description.
     * @returns The created template record.
     * @throws TEMPLATE_KEY_EXISTS if a template with this collection, blockType, and propertyKey already exists.
     * @example await cmsClient.templates.createTemplate({ collection: 'pages', blockType: 'hero', propertyKey: 'title', template: 'Welcome to {{siteName}}' })
     */
    createTemplate: createCMSEndpoint(
      '/templates/create',
      {
        method: 'POST',
        body: z.object({
          collection: z.string(),
          blockType: z.string(),
          propertyKey: z.string(),
          template: z.string(),
          description: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                collection: string;
                blockType: string;
                propertyKey: string;
                template: string;
                description?: string;
              },
            },
          },
          { ...META, operation: 'create' },
        ),
      },
      async (ctx) => {
        const { collection, blockType, propertyKey, template, description } =
          ctx.body;
        const userId = ctx.context.userId;

        const [existing] = await db
          .select({ id: templates.id })
          .from(templates)
          .where(
            and(
              eq(templates.collection, collection),
              eq(templates.blockType, blockType),
              eq(templates.propertyKey, propertyKey),
            ),
          );
        if (existing) throw new CMSError('TEMPLATE_KEY_EXISTS');

        return db.transaction(async (tx) => {
          const [row] = await tx
            .insert(templates)
            .values({
              collection,
              blockType,
              propertyKey,
              template,
              description: description ?? null,
              createdBy: userId,
              updatedBy: userId,
            })
            .returning();

          await syncTemplateVariableUsages(tx, row.id, template);

          return { template: row };
        });
      },
    ),

    /**
     * Updates a template's template string and/or description, and re-syncs variable usages if the template string changes.
     * @param id - The template ID.
     * @param template - The new template string (optional; if omitted, the current value is preserved).
     * @param description - The new description (optional; if omitted, the current value is preserved).
     * @returns The updated template record.
     * @throws TEMPLATE_NOT_FOUND if the template does not exist.
     * @example await cmsClient.templates.updateTemplate({ id: 'tpl_abc123', template: 'Updated {{siteName}} content' })
     */
    updateTemplate: createCMSEndpoint(
      '/templates/update',
      {
        method: 'POST',
        body: z.object({
          id: z.string(),
          template: z.string().optional(),
          description: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                id: string;
                template?: string;
                description?: string;
              },
            },
          },
          { ...META, operation: 'update' },
        ),
      },
      async (ctx) => {
        const { id, template, description } = ctx.body;
        const userId = ctx.context.userId;

        const [existing] = await db
          .select()
          .from(templates)
          .where(eq(templates.id, id));
        if (!existing) throw new CMSError('TEMPLATE_NOT_FOUND');

        return db.transaction(async (tx) => {
          const updates: Record<string, unknown> = {
            updatedBy: userId,
            updatedAt: new Date(),
          };
          if (template !== undefined) updates.template = template;
          if (description !== undefined) updates.description = description;

          const [updated] = await tx
            .update(templates)
            .set(updates)
            .where(eq(templates.id, id))
            .returning();

          if (template !== undefined) {
            await syncTemplateVariableUsages(tx, id, template);
          }

          return { template: updated };
        });
      },
    ),

    /**
     * Deletes a template by ID.
     * @param id - The template ID.
     * @returns An object with deleted: true.
     * @throws TEMPLATE_NOT_FOUND if the template does not exist.
     * @example await cmsClient.templates.deleteTemplate({ id: 'tpl_abc123' })
     */
    deleteTemplate: createCMSEndpoint(
      '/templates/delete',
      {
        method: 'POST',
        body: z.object({ id: z.string() }),
        metadata: cmsMeta(
          { $Infer: { body: {} as { id: string } } },
          { ...META, operation: 'delete' },
        ),
      },
      async (ctx) => {
        const [existing] = await db
          .select({ id: templates.id })
          .from(templates)
          .where(eq(templates.id, ctx.body.id));
        if (!existing) throw new CMSError('TEMPLATE_NOT_FOUND');

        await db.delete(templates).where(eq(templates.id, ctx.body.id));
        return { deleted: true };
      },
    ),

    /**
     * Resolves a template string by substituting {{variableKey}} placeholders with their current values from the variables table.
     * @param template - The template string to resolve.
     * @returns The resolved template string with variables substituted (unresolved placeholders remain as-is).
     * @example await cmsClient.templates.resolveTemplate({ template: 'Hello {{userName}}, welcome to {{siteName}}' })
     */
    resolveTemplate: createCMSEndpoint(
      '/templates/resolve',
      {
        method: 'POST',
        body: z.object({ template: z.string() }),
        metadata: cmsMeta(
          { $Infer: { body: {} as { template: string } } },
          { ...META, operation: 'read' },
        ),
      },
      async (ctx) => {
        const vars = await loadVariables(db);
        const resolved = resolveTemplateString(ctx.body.template, vars);
        return { resolved };
      },
    ),

    /**
     * Gets resolved default values for all templates of a specific collection and blockType.
     * @param collection - The collection name.
     * @param blockType - The block type.
     * @returns An object mapping propertyKey to the resolved template string; empty if no templates exist for this collection/blockType pair.
     * @example await cmsClient.templates.getTemplateDefaults({ collection: 'pages', blockType: 'hero' })
     */
    getTemplateDefaults: createCMSEndpoint(
      '/templates/defaults',
      {
        method: 'GET',
        query: z.object({
          collection: z.string(),
          blockType: z.string(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as { collection: string; blockType: string },
            },
          },
          { ...META, operation: 'read' },
        ),
      },
      async (ctx) => {
        const { collection, blockType } = ctx.query;

        const rows = await db
          .select()
          .from(templates)
          .where(
            and(
              eq(templates.collection, collection),
              eq(templates.blockType, blockType),
            ),
          );

        if (rows.length === 0) return { defaults: {} };

        const vars = await loadVariables(db);
        const defaults: Record<string, string> = {};
        for (const row of rows) {
          defaults[row.propertyKey] = resolveTemplateString(row.template, vars);
        }

        return { defaults };
      },
    ),
  };
}

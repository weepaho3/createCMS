import { eq } from 'drizzle-orm';
import * as z from 'zod';

import type { RevalidationRunner } from '../revalidation';
import type { CMSProcedureCtx } from '../types';

import { variables } from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError } from '../errors';
import {
  findPublishedRootsUsingVariable,
  getVariableUsageDetails,
  isVariableInUse,
} from '../variables';

const META = { scope: 'system' as const, permissionResource: 'variables' };

export function createVariableEndpoints(
  cmsCtx: CMSProcedureCtx,
  revalidationRunner: RevalidationRunner | null,
) {
  const { db } = cmsCtx;

  return {
    /**
     * Retrieve all variables ordered by key.
     * @returns An array of all variables with their keys, values, descriptions, and metadata.
     */
    listVariables: createCMSEndpoint(
      '/variables',
      {
        method: 'GET',
        metadata: cmsMeta(
          { $Infer: { query: {} } },
          { ...META, operation: 'read' },
        ),
      },
      async () => {
        const rows = await db.select().from(variables).orderBy(variables.key);
        return { variables: rows };
      },
    ),

    /**
     * Retrieve a single variable by its key and check if it is currently in use.
     * @param key The unique variable key to retrieve.
     * @returns The variable and a boolean indicating whether it is referenced in live content or templates.
     * @throws VARIABLE_NOT_FOUND if no variable exists with the given key.
     */
    getVariable: createCMSEndpoint(
      '/variables/get',
      {
        method: 'GET',
        query: z.object({ key: z.string() }),
        metadata: cmsMeta(
          { $Infer: { query: {} as { key: string } } },
          { ...META, operation: 'read' },
        ),
      },
      async (ctx) => {
        const { key } = ctx.query;
        const [variable] = await db
          .select()
          .from(variables)
          .where(eq(variables.key, key));
        if (!variable) throw new CMSError('VARIABLE_NOT_FOUND');

        const inUse = await isVariableInUse(db, key);
        return { variable, inUse };
      },
    ),

    /**
     * Create a new variable with a unique key.
     * The key must contain only alphanumeric characters and underscores.
     * @param key The unique variable key (1–100 characters, alphanumeric + underscore only).
     * @param value The variable value as a string.
     * @param description Optional description of the variable's purpose.
     * @returns The created variable with id, timestamps, and creator metadata.
     * @throws VARIABLE_KEY_EXISTS if a variable with this key already exists.
     * @example await cmsClient.variables.createVariable({ key: 'app_name', value: 'MyApp', description: 'Application name' })
     */
    createVariable: createCMSEndpoint(
      '/variables/create',
      {
        method: 'POST',
        body: z.object({
          key: z
            .string()
            .min(1)
            .max(100)
            .regex(
              /^\w+$/,
              'Key must contain only alphanumeric characters and underscores',
            ),
          value: z.string(),
          description: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                key: string;
                value: string;
                description?: string;
              },
            },
          },
          { ...META, operation: 'create' },
        ),
      },
      async (ctx) => {
        const { key, value, description } = ctx.body;
        const userId = ctx.context.userId;

        const [existing] = await db
          .select({ id: variables.id })
          .from(variables)
          .where(eq(variables.key, key));
        if (existing) throw new CMSError('VARIABLE_KEY_EXISTS');

        const [variable] = await db
          .insert(variables)
          .values({
            key,
            value,
            description: description ?? null,
            createdBy: userId,
            updatedBy: userId,
          })
          .returning();

        return { variable };
      },
    ),

    /**
     * Update an existing variable's value and/or description; triggers revalidation of published content if the value changes.
     * @param key The unique variable key to update.
     * @param value Optional new value for the variable.
     * @param description Optional new description.
     * @returns The updated variable.
     * @throws VARIABLE_NOT_FOUND if no variable exists with the given key.
     * @example await cmsClient.variables.updateVariable({ key: 'app_name', value: 'UpdatedApp' })
     */
    updateVariable: createCMSEndpoint(
      '/variables/update',
      {
        method: 'POST',
        body: z.object({
          key: z.string(),
          value: z.string().optional(),
          description: z.string().optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                key: string;
                value?: string;
                description?: string;
              },
            },
          },
          { ...META, operation: 'update' },
        ),
      },
      async (ctx) => {
        const { key, value, description } = ctx.body;
        const userId = ctx.context.userId;

        const [existing] = await db
          .select()
          .from(variables)
          .where(eq(variables.key, key));
        if (!existing) throw new CMSError('VARIABLE_NOT_FOUND');

        const updates: Record<string, unknown> = {
          updatedBy: userId,
          updatedAt: new Date(),
        };
        if (value !== undefined) updates.value = value;
        if (description !== undefined) updates.description = description;

        const [updated] = await db
          .update(variables)
          .set(updates)
          .where(eq(variables.key, key))
          .returning();

        if (
          value !== undefined &&
          value !== existing.value &&
          revalidationRunner
        ) {
          const affected = await findPublishedRootsUsingVariable(db, key);
          for (const root of affected) {
            await revalidationRunner.postProcess(
              'updateBlock',
              root.collection,
              { rootId: root.rootId, branchId: root.branchId },
              null,
            );
          }
        }

        return { variable: updated };
      },
    ),

    /**
     * Delete a variable; fails if it is currently referenced in live content or templates.
     * @param key The unique variable key to delete.
     * @returns A boolean confirming deletion.
     * @throws VARIABLE_NOT_FOUND if no variable exists with the given key.
     * @throws VARIABLE_IN_USE if the variable is referenced in any live content or template.
     * @example await cmsClient.variables.deleteVariable({ key: 'deprecated_var' })
     */
    deleteVariable: createCMSEndpoint(
      '/variables/delete',
      {
        method: 'POST',
        body: z.object({ key: z.string() }),
        metadata: cmsMeta(
          { $Infer: { body: {} as { key: string } } },
          { ...META, operation: 'delete' },
        ),
      },
      async (ctx) => {
        const { key } = ctx.body;

        const [existing] = await db
          .select({ id: variables.id })
          .from(variables)
          .where(eq(variables.key, key));
        if (!existing) throw new CMSError('VARIABLE_NOT_FOUND');

        if (await isVariableInUse(db, key)) {
          throw new CMSError('VARIABLE_IN_USE');
        }

        await db.delete(variables).where(eq(variables.key, key));

        return { deleted: true };
      },
    ),

    /**
     * Retrieve all locations where a variable is currently used in live content blocks and templates.
     * @param key The unique variable key to inspect.
     * @returns Block usages (distinct rootId, blockId, propertyKey tuples in branch heads) and template usages with counts.
     * @throws VARIABLE_NOT_FOUND if no variable exists with the given key.
     */
    getVariableUsages: createCMSEndpoint(
      '/variables/usages',
      {
        method: 'GET',
        query: z.object({ key: z.string() }),
        metadata: cmsMeta(
          { $Infer: { query: {} as { key: string } } },
          { ...META, operation: 'read' },
        ),
      },
      async (ctx) => {
        const { key } = ctx.query;

        const [existing] = await db
          .select({ id: variables.id })
          .from(variables)
          .where(eq(variables.key, key));
        if (!existing) throw new CMSError('VARIABLE_NOT_FOUND');

        return getVariableUsageDetails(db, key);
      },
    ),
  };
}

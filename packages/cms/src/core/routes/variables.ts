import { and, count, eq, ilike } from 'drizzle-orm';
import * as z from 'zod';

import type { RevalidationRunner } from '../revalidation';
import type { CMSProcedureCtx } from '../types';
import type { ResolvedScope } from '../types/definitions';

import { newId } from '../../utils/nanoid';
import { variables } from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError } from '../errors';
import { scopedInsert, variableScopeConditions } from '../scope';
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

  // CRUD targets the EXACT active cell (tenant + language). Unlike content
  // reads (which fall back across languages), managing a variable always means
  // the active language's own row — so we filter by the full insert scope, not
  // the read `where` (which deliberately omits language for the fallback).
  const cellConditions = (scope: ResolvedScope | undefined) =>
    variableScopeConditions(scope?.variables?.insertColumns);

  return {
    /**
     * Retrieve variables ordered by key, paginated and optionally filtered by key search.
     * @param limit Pagination limit (default 50, max 100).
     * @param offset Pagination offset (default 0).
     * @param search Optional case-insensitive substring match against the variable key.
     * @returns Paginated result with variables array, total count, and hasMore flag.
     */
    listVariables: createCMSEndpoint(
      '/variables/listVariables',
      {
        method: 'GET',
        query: z
          .object({
            limit: z.coerce.number().min(1).max(100).optional(),
            offset: z.coerce.number().min(0).optional(),
            search: z.string().optional(),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as
                | {
                    limit?: number;
                    offset?: number;
                    search?: string;
                  }
                | undefined,
            },
          },
          { ...META, operation: 'read' },
        ),
      },
      async (ctx) => {
        const limit = ctx.query?.limit ?? 50;
        const offset = ctx.query?.offset ?? 0;
        const search = ctx.query?.search;

        const conditions = [...cellConditions(ctx.context.scope)];
        if (search) conditions.push(ilike(variables.key, `%${search}%`));

        const [countResult] = await db
          .select({ count: count() })
          .from(variables)
          .where(and(...conditions));
        const total = countResult?.count ?? 0;

        const rows = await db
          .select()
          .from(variables)
          .where(and(...conditions))
          .orderBy(variables.key)
          .limit(limit)
          .offset(offset);

        return {
          variables: rows,
          total,
          hasMore: offset + rows.length < total,
        };
      },
    ),

    /**
     * Retrieve a single variable by its key and check if it is currently in use.
     * @param key The unique variable key to retrieve.
     * @returns The variable and a boolean indicating whether it is referenced in live content or templates.
     * @throws VARIABLE_NOT_FOUND if no variable exists with the given key.
     */
    getVariable: createCMSEndpoint(
      '/variables/getVariable',
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
        const scope = ctx.context.scope;
        const [variable] = await db
          .select()
          .from(variables)
          .where(and(eq(variables.key, key), ...cellConditions(scope)));
        if (!variable) throw new CMSError('VARIABLE_NOT_FOUND');

        const inUse = await isVariableInUse(db, key, scope);
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
      '/variables/createVariable',
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
        const scope = ctx.context.scope;

        // App-level uniqueness authority, scoped to the active cell (tenant +
        // language) — the DB unique was demoted (see core-schema.ts).
        const [existing] = await db
          .select({ id: variables.id })
          .from(variables)
          .where(and(eq(variables.key, key), ...cellConditions(scope)));
        if (existing) throw new CMSError('VARIABLE_KEY_EXISTS');

        // Raw scoped insert so plugin-owned columns (tenant_slug, language) are
        // stamped — they are not part of the core Drizzle `variables` table.
        const id = newId('variable');
        await scopedInsert(
          db,
          'cms.variables',
          {
            id,
            key,
            value,
            description: description ?? null,
            created_by: userId ?? null,
            updated_by: userId ?? null,
          },
          scope?.variables,
        );

        // Re-read via Drizzle so the response keeps the camelCase shape. The id
        // is freshly minted above, so the scope filter is belt-and-suspenders —
        // it keeps every read uniformly scoped.
        const [variable] = await db
          .select()
          .from(variables)
          .where(and(eq(variables.id, id), ...cellConditions(scope)));

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
      '/variables/updateVariable',
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
        const scope = ctx.context.scope;

        const [existing] = await db
          .select()
          .from(variables)
          .where(and(eq(variables.key, key), ...cellConditions(scope)));
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
          .where(and(eq(variables.key, key), ...cellConditions(scope)))
          .returning();

        if (
          value !== undefined &&
          value !== existing.value &&
          revalidationRunner
        ) {
          const affected = await findPublishedRootsUsingVariable(
            db,
            key,
            scope,
          );
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
     * @returns The id of the deleted variable.
     * @throws VARIABLE_NOT_FOUND if no variable exists with the given key.
     * @throws VARIABLE_IN_USE if the variable is referenced in any live content or template.
     * @example await cmsClient.variables.deleteVariable({ key: 'deprecated_var' })
     */
    deleteVariable: createCMSEndpoint(
      '/variables/deleteVariable',
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
        const scope = ctx.context.scope;

        const [existing] = await db
          .select({ id: variables.id })
          .from(variables)
          .where(and(eq(variables.key, key), ...cellConditions(scope)));
        if (!existing) throw new CMSError('VARIABLE_NOT_FOUND');

        if (await isVariableInUse(db, key, scope)) {
          throw new CMSError('VARIABLE_IN_USE');
        }

        await db
          .delete(variables)
          .where(and(eq(variables.key, key), ...cellConditions(scope)));

        return { variableId: existing.id };
      },
    ),

    /**
     * Retrieve all locations where a variable is currently used in live content blocks and templates.
     * @param key The unique variable key to inspect.
     * @returns Block usages (distinct rootId, blockId, propertyKey tuples in branch heads) and template usages with counts.
     * @throws VARIABLE_NOT_FOUND if no variable exists with the given key.
     */
    getVariableUsages: createCMSEndpoint(
      '/variables/getVariableUsages',
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
        const scope = ctx.context.scope;

        const [existing] = await db
          .select({ id: variables.id })
          .from(variables)
          .where(and(eq(variables.key, key), ...cellConditions(scope)));
        if (!existing) throw new CMSError('VARIABLE_NOT_FOUND');

        return getVariableUsageDetails(db, key, scope);
      },
    ),
  };
}

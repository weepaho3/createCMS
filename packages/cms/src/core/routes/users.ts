import { sql } from 'drizzle-orm';
import * as z from 'zod';

import type { CMSProcedureContext } from '../types';
import type { DrizzleInstance } from '../types/drizzle';
import type { ResolvedUserConfig } from '../user/resolve';

import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { extractUserFromRow, userJoinFragments } from '../user/join-helpers';
import {
  assertSafeSqlIdentifier,
  assertSafeSqlTableRef,
} from '../user/resolve';

// A normal permission resource for the user-directory reads. The app's auth
// middleware decides who may call these (e.g. anyone who can pick a reviewer);
// `permissionResource` is a plain string threaded to that middleware, so 'user'
// needs no core-side registration.
const META = { scope: 'system' as const, permissionResource: 'user' as const };

/**
 * A single user record crossing the API: the id plus the configured
 * `user.exposeColumns` (the security allowlist). Non-exposed columns (password
 * hashes, tokens, …) are never selected — see `resolveUserColumns`.
 */
export type ExposedUser = { id: string } & Record<string, unknown>;

/**
 * Reads users from the configured `user.table`, projecting the id + the
 * `exposeColumns` allowlist. Reuses the same JOIN/extract helpers the `withUser`
 * enrichment path uses, so the exposed shape is identical everywhere.
 *
 * @param id - When set, restricts to the single user with this id (for whoami).
 */
async function fetchExposedUsers(
  db: DrizzleInstance,
  uc: ResolvedUserConfig,
  opts: { id?: string; limit?: number; offset?: number } = {},
): Promise<ExposedUser[]> {
  // Defense-in-depth: `sqlTableRef` and `idColumnDbName` are spliced into the
  // raw SELECT/FROM below (like `batchFetchUsers`). `resolveUserConfig` already
  // validates them; re-assert so a hand-built config can never bypass the guard.
  assertSafeSqlTableRef(uc.sqlTableRef);
  assertSafeSqlIdentifier(uc.idColumnDbName, 'user id column');

  // `withUser: true` → every allowlisted (non-id) column. Empty SELECT fragment
  // when the allowlist is empty; the id is always selected separately.
  const frags = userJoinFragments(uc, `u.${uc.idColumnDbName}`, 'u', true);
  const idCol = sql.raw(`u.${uc.idColumnDbName}`);

  const where =
    opts.id !== undefined ? sql`WHERE ${idCol} = ${opts.id}` : sql``;
  const limit = opts.limit !== undefined ? sql`LIMIT ${opts.limit}` : sql``;
  const offset = opts.offset !== undefined ? sql`OFFSET ${opts.offset}` : sql``;

  const result = await db.execute(sql`
    SELECT ${idCol} AS user_id ${frags.selectColumns}
    FROM ${sql.raw(uc.sqlTableRef)} AS u
    ${where}
    ORDER BY ${idCol}
    ${limit}
    ${offset}
  `);

  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    id: row.user_id as string,
    // `extractUserFromRow` is null when every exposed column is null (or none
    // are exposed); the id alone is still a valid record.
    ...extractUserFromRow(row, 'u', uc, true),
  }));
}

/**
 * User-directory endpoints: current-user identity (`whoami`) and reviewer
 * discovery (`listReviewers`). Both read the configured `user.table` through the
 * same enrichment allowlist as `withUser`, and degrade sensibly when no
 * `user` config is present (whoami → `{ user: null }`, listReviewers → `[]`).
 */
export function createUserEndpoints(cmsCtx: CMSProcedureContext) {
  const { db } = cmsCtx;

  return {
    /**
     * Returns the current request's user id and its resolved user row (the
     * configured `exposeColumns`), so a client can learn who it is without the
     * app supplying the id. Both fields are `null` when unauthenticated, and
     * `user` is `null` when no `user.table` is configured or the id matches no row.
     *
     * @returns `{ userId, user }` — `userId` is `ctx.context.userId ?? null`;
     *          `user` is `{ id, ...exposeColumns }` or `null`.
     *
     * @example
     * const { userId, user } = await cmsClient.users.whoami();
     */
    whoami: createCMSEndpoint(
      '/users/whoami',
      {
        method: 'GET',
        metadata: cmsMeta({}, { ...META, operation: 'read' }),
      },
      async (ctx) => {
        const userId = ctx.context.userId ?? null;
        const uc = cmsCtx.resolvedUser;
        if (!userId || !uc) return { userId, user: null as ExposedUser | null };

        const [user] = await fetchExposedUsers(db, uc, { id: userId });
        return { userId, user: user ?? null };
      },
    ),

    /**
     * Lists candidate reviewer users from the configured `user.table`, each as
     * `{ id, ...exposeColumns }` — the picker source for approval workflows.
     * Returns an empty array when no `user.table` is configured.
     *
     * @param limit - Max users to return (1–100, default 100).
     * @param offset - Pagination offset (default 0).
     * @returns An array of `{ id, ...exposeColumns }`, ordered by id.
     *
     * @example
     * const reviewers = await cmsClient.users.listReviewers();
     */
    listReviewers: createCMSEndpoint(
      '/users/listReviewers',
      {
        method: 'GET',
        query: z
          .object({
            limit: z.coerce.number().min(1).max(100).optional(),
            offset: z.coerce.number().min(0).optional(),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as { limit?: number; offset?: number } | undefined,
            },
          },
          { ...META, operation: 'read' },
        ),
      },
      async (ctx) => {
        const uc = cmsCtx.resolvedUser;
        if (!uc) return [] as ExposedUser[];

        const limit = ctx.query?.limit ?? 100;
        const offset = ctx.query?.offset ?? 0;
        return fetchExposedUsers(db, uc, { limit, offset });
      },
    ),
  };
}

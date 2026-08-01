import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import * as z from 'zod';

import type {
  CollectionWithName,
  CMSProcedureContext,
  ResolvedScope,
} from '../types';
import type { DrizzleInstance } from '../types/drizzle';

import { requireRootInScope } from '../blocks/guards';
import {
  commentMentions,
  commentMessages,
  commentMessageTypeEnum,
  commentSystemTypeEnum,
  commentThreads,
  commentThreadStatusEnum,
  commentThreadTargetEnum,
  commits,
  mergeRequests,
  roots,
} from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError } from '../errors';
import { withNotifications } from '../notifications/service';
import { userEnrichment, type EnrichField } from '../user/enrichment';
import { batchFetchUsers } from '../user/join-helpers';
import { parseTimestamp, parseTimestampOrNull } from '../utils/parse-timestamp';

const targetTypeSchema = z.enum(commentThreadTargetEnum.enumValues);
const threadStatusSchema = z.enum(commentThreadStatusEnum.enumValues);

/** The two user-id fields enriched on a comment thread row (creator + resolver). */
const COMMENT_THREAD_USER_FIELDS: EnrichField[] = [
  {
    cmsColumn: 'cms.comment_threads.created_by',
    alias: 'thread_creator',
    outputKey: 'createdByUser',
  },
  {
    cmsColumn: 'cms.comment_threads.resolved_by',
    alias: 'thread_resolver',
    outputKey: 'resolvedByUser',
    nullGuardCol: 'resolved_by',
  },
];

type ThreadOutput = {
  id: string;
  rootId: string | null;
  collection: string;
  targetType: (typeof commentThreadTargetEnum.enumValues)[number];
  mergeRequestId: string | null;
  blockId: string | null;
  commitId: string | null;
  status: (typeof commentThreadStatusEnum.enumValues)[number];
  resolvedBy: string | null;
  resolvedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

type MessageOutput = {
  id: string;
  threadId: string;
  parentMessageId: string | null;
  authorId: string | null;
  messageType: (typeof commentMessageTypeEnum.enumValues)[number];
  systemType: (typeof commentSystemTypeEnum.enumValues)[number] | null;
  body: string | null;
  meta: Record<string, unknown> | null;
  mentions: string[];
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapThread(row: typeof commentThreads.$inferSelect): ThreadOutput {
  return {
    id: row.id,
    rootId: row.rootId,
    collection: row.collection,
    targetType: row.targetType,
    mergeRequestId: row.mergeRequestId,
    blockId: row.blockId,
    commitId: row.commitId,
    status: row.status,
    resolvedBy: row.resolvedBy,
    resolvedAt: row.resolvedAt ? new Date(row.resolvedAt) : null,
    createdBy: row.createdBy,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

/**
 * Maps a raw (snake_case, string-typed) thread row from the enriched
 * `db.execute` SELECT into the camelCase thread output shape. Shared by
 * `listCommentThreads` and `getCommentThread`, which read threads through the
 * user-enrichment JOIN rather than through Drizzle's typed select (so the row
 * arrives as `Record<string, unknown>`, not `commentThreads.$inferSelect`).
 * This is intentionally distinct from {@link mapThread}, which maps a typed row.
 */
function mapRawThreadRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: row.id,
    rootId: row.root_id,
    collection: row.collection,
    targetType: row.target_type,
    mergeRequestId: row.merge_request_id,
    blockId: row.block_id,
    commitId: row.commit_id,
    status: row.status,
    resolvedBy: row.resolved_by,
    resolvedAt: parseTimestampOrNull(row.resolved_at),
    createdBy: row.created_by,
    createdAt: parseTimestamp(row.created_at),
    updatedAt: parseTimestamp(row.updated_at),
  };
}

function mapMessage(
  row: typeof commentMessages.$inferSelect,
  mentions: string[] = [],
): MessageOutput {
  return {
    id: row.id,
    threadId: row.threadId,
    parentMessageId: row.parentMessageId,
    authorId: row.authorId,
    messageType: row.messageType,
    systemType: row.systemType,
    body: row.deletedAt ? null : row.body,
    meta: row.meta,
    mentions,
    editedAt: row.editedAt ? new Date(row.editedAt) : null,
    deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

/**
 * Deduplicate mention user IDs and exclude the author (self-mention).
 */
function resolveMentions(
  raw: string[] | undefined,
  authorId: string,
): string[] {
  if (!raw || raw.length === 0) return [];
  return [...new Set(raw)].filter((id) => id !== authorId);
}

/**
 * Bulk-insert mention rows for a single message.
 */
async function insertMentions(
  tx: DrizzleInstance,
  messageId: string,
  threadId: string,
  mentionedBy: string,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  await tx.insert(commentMentions).values(
    userIds.map((uid) => ({
      messageId,
      threadId,
      mentionedUserId: uid,
      mentionedBy,
    })),
  );
}

/**
 * Load mentions grouped by messageId for a set of message IDs.
 */
async function loadMentionsByMessageIds(
  db: DrizzleInstance,
  messageIds: string[],
): Promise<Map<string, string[]>> {
  if (messageIds.length === 0) return new Map();

  const rows = await db
    .select({
      messageId: commentMentions.messageId,
      mentionedUserId: commentMentions.mentionedUserId,
    })
    .from(commentMentions)
    .where(inArray(commentMentions.messageId, messageIds));

  const map = new Map<string, string[]>();
  for (const row of rows) {
    const existing = map.get(row.messageId);
    if (existing) {
      existing.push(row.mentionedUserId);
    } else {
      map.set(row.messageId, [row.mentionedUserId]);
    }
  }
  return map;
}

/**
 * Loads the boundary (first or latest) non-deleted comment message per thread
 * for a set of thread IDs. `direction: 'asc'` selects the earliest message per
 * thread, `'desc'` the most recent. The `DISTINCT ON` subquery repeats the
 * comment/not-deleted filter so it picks the boundary among the same rows the
 * outer `and(commentFilter, ...)` returns.
 */
async function loadBoundaryMessages(
  db: DrizzleInstance,
  threadIds: string[],
  direction: 'asc' | 'desc',
): Promise<(typeof commentMessages.$inferSelect)[]> {
  const order = direction === 'asc' ? sql`ASC` : sql`DESC`;

  const commentFilter = and(
    inArray(commentMessages.threadId, threadIds),
    eq(commentMessages.messageType, 'comment'),
    isNull(commentMessages.deletedAt),
  );

  return db
    .select()
    .from(commentMessages)
    .where(
      and(
        commentFilter,
        sql`${commentMessages.id} IN (
          SELECT DISTINCT ON (${commentMessages.threadId}) ${commentMessages.id}
          FROM ${commentMessages}
          WHERE ${inArray(commentMessages.threadId, threadIds)}
            AND ${commentMessages.messageType} = 'comment'
            AND ${commentMessages.deletedAt} IS NULL
          ORDER BY ${commentMessages.threadId}, ${commentMessages.createdAt} ${order}
        )`,
      ),
    );
}

/**
 * Loads a comment thread by id, enforcing the collection, the soft-delete
 * filter, and — when the thread is attached to a root — the caller's active
 * scope. This is the choke point that closes cross-scope IDOR on every
 * thread-addressed endpoint; resolving a thread by id without it lets a caller
 * in one scope read or mutate another scope's thread by guessing an id.
 *
 * Pass `forUpdate: true` to hold a `FOR UPDATE` row lock for the rest of the
 * caller's transaction (mirrors the lock the mutating thread endpoints took
 * before they had a shared loader to route through).
 */
async function loadThreadInScope(
  exec: DrizzleInstance,
  threadId: string,
  collection: string,
  scope: ResolvedScope,
  forUpdate = false,
): Promise<typeof commentThreads.$inferSelect> {
  const condition = and(
    eq(commentThreads.id, threadId),
    eq(commentThreads.collection, collection),
    isNull(commentThreads.deletedAt),
  );

  const [thread] = forUpdate
    ? await exec.select().from(commentThreads).where(condition).for('update')
    : await exec.select().from(commentThreads).where(condition);

  if (!thread) throw new CMSError('COMMENT_THREAD_NOT_FOUND');

  // IDOR: when the thread is attached to a root, enforce the active scope on
  // that root (root-less threads fall back to collection scoping, matching
  // the sibling comment endpoints).
  if (thread.rootId) {
    await requireRootInScope(
      exec,
      thread.rootId,
      collection,
      scope.roots,
      'COMMENT_THREAD_NOT_FOUND',
    );
  }

  return thread;
}

export function createCommentEndpoints<TDef extends CollectionWithName>(
  def: TDef,
  cmsCtx: CMSProcedureContext,
) {
  const { db } = cmsCtx;
  const collectionName = def.name;

  return {
    /**
     * Creates a new comment thread with an initial message and optional mentions.
     * Validates referenced merge request and commit if provided; enforces root scope when applicable.
     * @param targetType 'mergeRequest' or 'block' (required; 'mergeRequest' requires mergeRequestId, 'block' requires blockId).
     * @param body The comment text; non-empty required.
     * @param mentions Array of user IDs to mention in the initial message (optional).
     * @param mergeRequestId The merge request to attach the thread to (required when targetType is 'mergeRequest'); also used to infer rootId.
     * @param blockId Block ID for 'block' targetType.
     * @param commitId Optional commit ID to link the thread to a specific snapshot.
     * @param rootId Optional root ID; inferred from merge request if not provided.
     * @returns Thread object with initial message, message count, and user enrichment for creator/resolver.
     * @throws USER_ID_REQUIRED if userId is not present.
     * @throws MERGE_REQUEST_NOT_FOUND if targetType='mergeRequest' and mergeRequestId does not exist or is out of scope.
     * @throws COMMIT_NOT_FOUND if commitId is provided but does not exist.
     * @example await cmsClient.pages.createCommentThread({ targetType: 'block', blockId: 'b1', body: 'Fix needed', mentions: ['user2'] })
     */
    createCommentThread: createCMSEndpoint(
      `/${collectionName}/createCommentThread`,
      {
        method: 'POST',
        body: z
          .object({
            targetType: targetTypeSchema,
            mergeRequestId: z.string().optional(),
            blockId: z.string().optional(),
            commitId: z.string().optional(),
            rootId: z.string().optional(),
            body: z.string().min(1),
            mentions: z.array(z.string()).optional(),
          })
          .refine(
            (v) => v.targetType !== 'mergeRequest' || !!v.mergeRequestId,
            {
              message:
                'mergeRequestId is required when targetType is mergeRequest',
            },
          )
          .refine((v) => v.targetType !== 'block' || !!v.blockId, {
            message: 'blockId is required when targetType is block',
          }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                targetType: 'mergeRequest' | 'block';
                mergeRequestId?: string;
                blockId?: string;
                commitId?: string;
                rootId?: string;
                body: string;
                mentions?: string[];
              },
            },
          },
          {
            permissionResource: 'comment',
            operation: 'create',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const input = ctx.body;
        const userId = ctx.context.userId;
        if (!userId) throw new CMSError('USER_ID_REQUIRED');

        return withNotifications(
          db,
          cmsCtx.notificationService,
          async (tx, pending) => {
            let rootId = input.rootId ?? null;

            if (input.mergeRequestId) {
              const [mr] = await tx
                .select({
                  id: mergeRequests.id,
                  rootId: mergeRequests.rootId,
                  status: mergeRequests.status,
                })
                .from(mergeRequests)
                .innerJoin(roots, eq(roots.id, mergeRequests.rootId))
                .where(
                  and(
                    eq(mergeRequests.id, input.mergeRequestId),
                    eq(roots.collection, collectionName),
                    ctx.context.scope.roots?.where,
                  ),
                );

              if (!mr) throw new CMSError('MERGE_REQUEST_NOT_FOUND');
              rootId = rootId ?? mr.rootId;
            }

            if (input.commitId) {
              const [commit] = await tx
                .select({ id: commits.id })
                .from(commits)
                .where(eq(commits.id, input.commitId));

              if (!commit) throw new CMSError('COMMIT_NOT_FOUND');
            }

            // IDOR: a caller-supplied rootId (explicit, or inferred above from
            // an already-scoped merge request) must itself be in the active
            // scope before it is written into the thread row.
            if (rootId) {
              await requireRootInScope(
                tx,
                rootId,
                collectionName,
                ctx.context.scope.roots,
                'COMMENT_THREAD_NOT_FOUND',
              );
            }

            const [thread] = await tx
              .insert(commentThreads)
              .values({
                rootId,
                collection: collectionName,
                targetType: input.targetType,
                mergeRequestId: input.mergeRequestId ?? null,
                blockId: input.blockId ?? null,
                commitId: input.commitId ?? null,
                createdBy: userId,
              })
              .returning();

            const [message] = await tx
              .insert(commentMessages)
              .values({
                threadId: thread.id,
                authorId: userId,
                messageType: 'comment',
                body: input.body,
              })
              .returning();

            const resolved = resolveMentions(input.mentions, userId);
            await insertMentions(tx, message.id, thread.id, userId, resolved);

            if (resolved.length > 0) {
              pending.push(
                ...resolved.map((uid) => ({
                  recipientId: uid,
                  actorId: userId,
                  type: 'mention' as const,
                  title: 'You were mentioned in a comment',
                  body: input.body,
                  resourceType: 'commentThread',
                  resourceId: thread.id,
                  collection: collectionName,
                  meta: {
                    messageId: message.id,
                    threadId: thread.id,
                    rootId: thread.rootId,
                  },
                })),
              );
            }

            return {
              thread: mapThread(thread),
              message: mapMessage(message, resolved),
            };
          },
        );
      },
    ),

    /**
     * Adds a reply (with optional nesting) to an existing comment thread.
     * @param threadId Required thread ID.
     * @param body Comment text; non-empty required.
     * @param parentMessageId Optional parent message ID for nested replies.
     * @param mentions Array of user IDs to mention in this message (optional).
     * @returns { message } envelope with resolved mentions; notifies thread creator and all mentioned users.
     * @throws USER_ID_REQUIRED if userId is not present.
     * @throws COMMENT_THREAD_NOT_FOUND if thread does not exist in this collection.
     * @throws COMMENT_MESSAGE_NOT_FOUND if parentMessageId does not exist in this thread.
     * @example await cmsClient.pages.createCommentMessage({ threadId: 't1', body: 'Addressed' })
     */
    createCommentMessage: createCMSEndpoint(
      `/${collectionName}/createCommentMessage`,
      {
        method: 'POST',
        body: z.object({
          threadId: z.string(),
          body: z.string().min(1),
          parentMessageId: z.string().optional(),
          mentions: z.array(z.string()).optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                threadId: string;
                body: string;
                parentMessageId?: string;
                mentions?: string[];
              },
            },
          },
          {
            permissionResource: 'comment',
            operation: 'create',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const input = ctx.body;
        const userId = ctx.context.userId;
        if (!userId) throw new CMSError('USER_ID_REQUIRED');

        return withNotifications(
          db,
          cmsCtx.notificationService,
          async (tx, pending) => {
            const thread = await loadThreadInScope(
              tx,
              input.threadId,
              collectionName,
              ctx.context.scope,
            );

            if (input.parentMessageId) {
              const [parent] = await tx
                .select({ id: commentMessages.id })
                .from(commentMessages)
                .where(
                  and(
                    eq(commentMessages.id, input.parentMessageId),
                    eq(commentMessages.threadId, input.threadId),
                  ),
                );

              if (!parent) throw new CMSError('COMMENT_MESSAGE_NOT_FOUND');
            }

            const [message] = await tx
              .insert(commentMessages)
              .values({
                threadId: input.threadId,
                authorId: userId,
                messageType: 'comment',
                body: input.body,
                parentMessageId: input.parentMessageId ?? null,
              })
              .returning();

            const resolved = resolveMentions(input.mentions, userId);
            await insertMentions(tx, message.id, thread.id, userId, resolved);

            await tx
              .update(commentThreads)
              .set({ updatedAt: new Date() })
              .where(eq(commentThreads.id, input.threadId));

            if (resolved.length > 0) {
              for (const uid of resolved) {
                pending.push({
                  recipientId: uid,
                  actorId: userId,
                  type: 'mention',
                  title: 'You were mentioned in a comment',
                  body: input.body,
                  resourceType: 'commentThread',
                  resourceId: thread.id,
                  collection: collectionName,
                  meta: {
                    messageId: message.id,
                    threadId: thread.id,
                    rootId: thread.rootId,
                  },
                });
              }
            }

            if (
              thread.createdBy &&
              thread.createdBy !== userId &&
              !resolved.includes(thread.createdBy)
            ) {
              pending.push({
                recipientId: thread.createdBy,
                actorId: userId,
                type: 'comment',
                title: 'New reply in your thread',
                body: input.body,
                resourceType: 'commentThread',
                resourceId: thread.id,
                collection: collectionName,
                meta: {
                  messageId: message.id,
                  threadId: thread.id,
                  rootId: thread.rootId,
                },
              });
            }

            return { message: mapMessage(message, resolved) };
          },
        );
      },
    ),

    /**
     * Lists comment threads filtered by target, status, or mentions with pagination.
     * @param mergeRequestId Optional filter by merge request ID.
     * @param blockId Optional filter by block ID.
     * @param commitId Optional filter by commit ID.
     * @param rootId Optional filter by root ID.
     * @param status Optional filter by 'open' or 'resolved'.
     * @param mentionedUserId Optional filter threads where this user was mentioned.
     * @param limit Page size (1–100, default 20).
     * @param offset Pagination offset (default 0).
     * @returns Paginated list of threads with message count, first/latest message summaries, and user enrichment.
     * @example await cmsClient.pages.listCommentThreads({ status: 'open', limit: 50 })
     */
    listCommentThreads: createCMSEndpoint(
      `/${collectionName}/listCommentThreads`,
      {
        method: 'GET',
        query: z
          .object({
            mergeRequestId: z.string().optional(),
            blockId: z.string().optional(),
            commitId: z.string().optional(),
            rootId: z.string().optional(),
            status: threadStatusSchema.optional(),
            mentionedUserId: z.string().optional(),
            limit: z.coerce.number().min(1).max(100).optional(),
            offset: z.coerce.number().min(0).optional(),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                mergeRequestId?: string;
                blockId?: string;
                commitId?: string;
                rootId?: string;
                status?: 'open' | 'resolved';
                mentionedUserId?: string;
                limit?: number;
                offset?: number;
              },
            },
          },
          {
            permissionResource: 'comment',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const input = ctx.query ?? {};
        const limit = input.limit ?? 20;
        const offset = input.offset ?? 0;

        const conditions = [
          eq(commentThreads.collection, collectionName),
          isNull(commentThreads.deletedAt),
        ];

        if (input.mergeRequestId) {
          conditions.push(
            eq(commentThreads.mergeRequestId, input.mergeRequestId),
          );
        }
        if (input.blockId) {
          conditions.push(eq(commentThreads.blockId, input.blockId));
        }
        if (input.commitId) {
          conditions.push(eq(commentThreads.commitId, input.commitId));
        }
        if (input.rootId) {
          conditions.push(eq(commentThreads.rootId, input.rootId));
        }
        if (input.status) {
          conditions.push(eq(commentThreads.status, input.status));
        }

        const useMentionFilter = !!input.mentionedUserId;

        if (useMentionFilter) {
          conditions.push(
            sql`${commentThreads.id} IN (
              SELECT DISTINCT ${commentMentions.threadId}
              FROM ${commentMentions}
              WHERE ${commentMentions.mentionedUserId} = ${input.mentionedUserId}
            )`,
          );
        }

        // IDOR: exclude threads whose root lies outside the caller's active
        // scope (root-less threads — e.g. pure block-targeted threads with no
        // merge request or explicit rootId — fall back to collection scoping,
        // matching the by-id endpoints).
        if (ctx.context.scope.roots?.where) {
          conditions.push(
            or(isNull(commentThreads.rootId), ctx.context.scope.roots.where)!,
          );
        }

        const whereCondition = and(...conditions)!;

        const enrich = userEnrichment(ctx, COMMENT_THREAD_USER_FIELDS);

        const [{ count }] = await db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(commentThreads)
          .leftJoin(roots, eq(roots.id, commentThreads.rootId))
          .where(whereCondition);

        const dataResult = await db.execute(sql`
          SELECT
            ${commentThreads.id},
            ${commentThreads.rootId} AS root_id,
            ${commentThreads.collection},
            ${commentThreads.targetType} AS target_type,
            ${commentThreads.mergeRequestId} AS merge_request_id,
            ${commentThreads.blockId} AS block_id,
            ${commentThreads.commitId} AS commit_id,
            ${commentThreads.status},
            ${commentThreads.resolvedBy} AS resolved_by,
            ${commentThreads.resolvedAt} AS resolved_at,
            ${commentThreads.createdBy} AS created_by,
            ${commentThreads.createdAt} AS created_at,
            ${commentThreads.updatedAt} AS updated_at
            ${enrich.select}
          FROM ${commentThreads}
          LEFT JOIN ${roots} ON ${roots.id} = ${commentThreads.rootId}
          ${enrich.join}
          WHERE ${whereCondition}
          ORDER BY ${commentThreads.createdAt} DESC
          LIMIT ${limit} OFFSET ${offset}
        `);

        const rawRows = dataResult.rows as Array<Record<string, unknown>>;
        const threadIds = rawRows.map((r) => r.id as string);

        const messageSummaries: Record<
          string,
          {
            messageCount: number;
            firstMessage: MessageOutput | null;
            latestMessage: MessageOutput | null;
          }
        > = {};

        if (threadIds.length > 0) {
          const msgCountRows = await db
            .select({
              threadId: commentMessages.threadId,
              count: sql<number>`count(*)`.mapWith(Number),
            })
            .from(commentMessages)
            .where(inArray(commentMessages.threadId, threadIds))
            .groupBy(commentMessages.threadId);

          const countMap = new Map(
            msgCountRows.map((r) => [r.threadId, r.count]),
          );

          const firstMessages = await loadBoundaryMessages(
            db,
            threadIds,
            'asc',
          );

          const latestMessages = await loadBoundaryMessages(
            db,
            threadIds,
            'desc',
          );

          const firstMap = new Map(firstMessages.map((m) => [m.threadId, m]));
          const latestMap = new Map(latestMessages.map((m) => [m.threadId, m]));

          const allSummaryMsgIds = [
            ...firstMessages.map((m) => m.id),
            ...latestMessages.map((m) => m.id),
          ].filter((id, i, arr) => arr.indexOf(id) === i);

          const mentionsMap = await loadMentionsByMessageIds(
            db,
            allSummaryMsgIds,
          );

          for (const tid of threadIds) {
            const first = firstMap.get(tid) ?? null;
            const latest = latestMap.get(tid) ?? null;

            messageSummaries[tid] = {
              messageCount: countMap.get(tid) ?? 0,
              firstMessage: first
                ? mapMessage(first, mentionsMap.get(first.id) ?? [])
                : null,
              latestMessage: latest
                ? mapMessage(latest, mentionsMap.get(latest.id) ?? [])
                : null,
            };
          }
        }

        return {
          threads: rawRows.map((row) => {
            const thread: Record<string, unknown> = {
              ...mapRawThreadRow(row),
              ...(messageSummaries[row.id as string] ?? {
                messageCount: 0,
                firstMessage: null,
                latestMessage: null,
              }),
            };

            enrich.apply(thread, row);

            return thread;
          }),
          total: count,
          hasMore: offset + rawRows.length < count,
        };
      },
    ),

    /**
     * Retrieves a single thread with all its messages in chronological order.
     * Includes user enrichment for thread creator/resolver; optionally enriches message authors.
     * @param threadId Required thread ID.
     * @returns Thread object, full message array (with deleted messages body masked), and optional author user profiles.
     * @throws COMMENT_THREAD_NOT_FOUND if thread does not exist or is deleted.
     * @example await cmsClient.pages.getCommentThread({ threadId: 't1' })
     */
    getCommentThread: createCMSEndpoint(
      `/${collectionName}/getCommentThread`,
      {
        method: 'GET',
        query: z.object({
          threadId: z.string(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as { threadId: string },
            },
          },
          {
            permissionResource: 'comment',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        // IDOR: resolve the thread through the scope-enforcing loader first —
        // the enrichment query below is a raw `db.execute` with a user-table
        // JOIN, so the scope predicate can't simply be ANDed into it. Two
        // queries is acceptable here; correctness over round-trips.
        await loadThreadInScope(
          db,
          ctx.query.threadId,
          collectionName,
          ctx.context.scope,
        );

        // withUser / uc stay in scope: the thread row is enriched via the JOIN
        // helper below, but per-message authors use the batchFetchUsers path.
        const withUser = ctx.context.withUser;
        const uc = ctx.context.userConfig;

        const enrich = userEnrichment(ctx, COMMENT_THREAD_USER_FIELDS);

        const threadResult = await db.execute(sql`
          SELECT
            ${commentThreads.id},
            ${commentThreads.rootId} AS root_id,
            ${commentThreads.collection},
            ${commentThreads.targetType} AS target_type,
            ${commentThreads.mergeRequestId} AS merge_request_id,
            ${commentThreads.blockId} AS block_id,
            ${commentThreads.commitId} AS commit_id,
            ${commentThreads.status},
            ${commentThreads.resolvedBy} AS resolved_by,
            ${commentThreads.resolvedAt} AS resolved_at,
            ${commentThreads.createdBy} AS created_by,
            ${commentThreads.createdAt} AS created_at,
            ${commentThreads.updatedAt} AS updated_at
            ${enrich.select}
          FROM ${commentThreads}
          ${enrich.join}
          WHERE ${commentThreads.id} = ${ctx.query.threadId}
            AND ${commentThreads.collection} = ${collectionName}
            AND ${commentThreads.deletedAt} IS NULL
        `);

        const threadRow = threadResult.rows[0] as
          | Record<string, unknown>
          | undefined;
        if (!threadRow) throw new CMSError('COMMENT_THREAD_NOT_FOUND');

        const messages = await db
          .select()
          .from(commentMessages)
          .where(eq(commentMessages.threadId, threadRow.id as string))
          .orderBy(asc(commentMessages.createdAt));

        const messageIds = messages.map((m) => m.id);
        const mentionsMap = await loadMentionsByMessageIds(db, messageIds);

        let msgUserMap: Map<string, Record<string, unknown>> | undefined;
        if (withUser && uc && messages.length > 0) {
          const authorIds = [
            ...new Set(
              messages
                .map((m) => m.authorId)
                .filter((id): id is string => !!id),
            ),
          ];
          msgUserMap = await batchFetchUsers(db, uc, withUser, authorIds);
        }

        const threadOutput: Record<string, unknown> =
          mapRawThreadRow(threadRow);

        enrich.apply(threadOutput, threadRow);

        return {
          thread: threadOutput,
          messages: messages.map((m) => {
            const msg: Record<string, unknown> = mapMessage(
              m,
              mentionsMap.get(m.id) ?? [],
            );
            if (msgUserMap && m.authorId) {
              msg.authorUser = msgUserMap.get(m.authorId) ?? null;
            }
            return msg;
          }),
        };
      },
    ),

    /**
     * Marks a comment thread as resolved and inserts a system message.
     * @param threadId Required thread ID.
     * @returns { thread, message } — the updated thread and the system message indicating resolution.
     * @throws USER_ID_REQUIRED if userId is not present.
     * @throws COMMENT_THREAD_NOT_FOUND if thread does not exist.
     * @throws COMMENT_THREAD_ALREADY_RESOLVED if thread is already resolved.
     * @example await cmsClient.pages.resolveCommentThread({ threadId: 't1' })
     */
    resolveCommentThread: createCMSEndpoint(
      `/${collectionName}/resolveCommentThread`,
      {
        method: 'POST',
        body: z.object({
          threadId: z.string(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { threadId: string },
            },
          },
          {
            permissionResource: 'comment',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const userId = ctx.context.userId;
        if (!userId) throw new CMSError('USER_ID_REQUIRED');

        return withNotifications(
          db,
          cmsCtx.notificationService,
          async (tx, pending) => {
            const thread = await loadThreadInScope(
              tx,
              ctx.body.threadId,
              collectionName,
              ctx.context.scope,
              true,
            );

            if (thread.status === 'resolved') {
              throw new CMSError('COMMENT_THREAD_ALREADY_RESOLVED');
            }

            const now = new Date();

            const [updated] = await tx
              .update(commentThreads)
              .set({
                status: 'resolved',
                resolvedBy: userId,
                resolvedAt: now,
                updatedAt: now,
              })
              .where(eq(commentThreads.id, thread.id))
              .returning();

            const [systemMsg] = await tx
              .insert(commentMessages)
              .values({
                threadId: thread.id,
                authorId: userId,
                messageType: 'system',
                systemType: 'threadResolved',
                meta: { by: userId },
              })
              .returning();

            if (thread.createdBy !== userId) {
              pending.push({
                recipientId: thread.createdBy,
                actorId: userId,
                type: 'threadResolved',
                title: 'Your comment thread was resolved',
                body: null,
                resourceType: 'commentThread',
                resourceId: thread.id,
                collection: collectionName,
                meta: { threadId: thread.id, rootId: thread.rootId },
              });
            }

            return {
              thread: mapThread(updated),
              message: mapMessage(systemMsg),
            };
          },
        );
      },
    ),

    /**
     * Soft-deletes a comment thread (hidden from list/get; messages + mentions removed on root deletion).
     * Enforces root scope if the thread is linked to a root.
     * @param threadId Required thread ID.
     * @returns Deleted thread ID.
     * @throws USER_ID_REQUIRED if userId is not present.
     * @throws COMMENT_THREAD_NOT_FOUND if thread does not exist.
     * @example await cmsClient.pages.deleteCommentThread({ threadId: 't1' })
     */
    deleteCommentThread: createCMSEndpoint(
      `/${collectionName}/deleteCommentThread`,
      {
        method: 'POST',
        body: z.object({ threadId: z.string() }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { threadId: string },
            },
          },
          {
            permissionResource: 'comment',
            operation: 'delete',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const userId = ctx.context.userId;
        if (!userId) throw new CMSError('USER_ID_REQUIRED');

        return db.transaction(async (tx) => {
          const thread = await loadThreadInScope(
            tx,
            ctx.body.threadId,
            collectionName,
            ctx.context.scope,
            true,
          );

          // Soft-delete: hidden from list/get; messages + mentions are removed
          // physically only when the owning root is pruned (FK cascade).
          await tx
            .update(commentThreads)
            .set({ deletedAt: new Date() })
            .where(eq(commentThreads.id, thread.id));

          return { threadId: thread.id };
        });
      },
    ),

    /**
     * Reopens a resolved comment thread and inserts a system message.
     * @param threadId Required thread ID.
     * @returns { thread, message } — the updated thread and the system message indicating reopening.
     * @throws USER_ID_REQUIRED if userId is not present.
     * @throws COMMENT_THREAD_NOT_FOUND if thread does not exist.
     * @throws COMMENT_THREAD_NOT_RESOLVED if thread is not currently resolved.
     * @example await cmsClient.pages.reopenCommentThread({ threadId: 't1' })
     */
    reopenCommentThread: createCMSEndpoint(
      `/${collectionName}/reopenCommentThread`,
      {
        method: 'POST',
        body: z.object({
          threadId: z.string(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { threadId: string },
            },
          },
          {
            permissionResource: 'comment',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const userId = ctx.context.userId;
        if (!userId) throw new CMSError('USER_ID_REQUIRED');

        return withNotifications(
          db,
          cmsCtx.notificationService,
          async (tx, pending) => {
            const thread = await loadThreadInScope(
              tx,
              ctx.body.threadId,
              collectionName,
              ctx.context.scope,
              true,
            );

            if (thread.status !== 'resolved') {
              throw new CMSError('COMMENT_THREAD_NOT_RESOLVED');
            }

            const now = new Date();

            const [updated] = await tx
              .update(commentThreads)
              .set({
                status: 'open',
                resolvedBy: null,
                resolvedAt: null,
                updatedAt: now,
              })
              .where(eq(commentThreads.id, thread.id))
              .returning();

            const [systemMsg] = await tx
              .insert(commentMessages)
              .values({
                threadId: thread.id,
                authorId: userId,
                messageType: 'system',
                systemType: 'threadReopened',
                meta: { by: userId },
              })
              .returning();

            if (thread.createdBy !== userId) {
              pending.push({
                recipientId: thread.createdBy,
                actorId: userId,
                type: 'threadReopened',
                title: 'Your comment thread was reopened',
                body: null,
                resourceType: 'commentThread',
                resourceId: thread.id,
                collection: collectionName,
                meta: {
                  threadId: thread.id,
                  rootId: thread.rootId,
                  reopened: true,
                },
              });
            }

            return {
              thread: mapThread(updated),
              message: mapMessage(systemMsg),
            };
          },
        );
      },
    ),

    /**
     * Updates a comment message body and optionally re-sets mentions.
     * Only the original author may edit; system messages cannot be edited.
     * @param messageId Required message ID.
     * @param body New comment text; non-empty required.
     * @param mentions Optional array of user IDs to re-mention (replaces old mentions).
     * @returns { message } envelope with the updated message and current mentions.
     * @throws USER_ID_REQUIRED if userId is not present.
     * @throws COMMENT_MESSAGE_NOT_FOUND if message does not exist.
     * @throws COMMENT_MESSAGE_DELETED if message is already deleted.
     * @throws COMMENT_AUTHOR_MISMATCH if userId is not the message author.
     * @example await cmsClient.pages.updateCommentMessage({ messageId: 'm1', body: 'Revised' })
     */
    updateCommentMessage: createCMSEndpoint(
      `/${collectionName}/updateCommentMessage`,
      {
        method: 'POST',
        body: z.object({
          messageId: z.string(),
          body: z.string().min(1),
          mentions: z.array(z.string()).optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as {
                messageId: string;
                body: string;
                mentions?: string[];
              },
            },
          },
          {
            permissionResource: 'comment',
            operation: 'update',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const userId = ctx.context.userId;
        if (!userId) throw new CMSError('USER_ID_REQUIRED');

        return db.transaction(async (tx) => {
          const [msg] = await tx
            .select({
              id: commentMessages.id,
              threadId: commentMessages.threadId,
              authorId: commentMessages.authorId,
              messageType: commentMessages.messageType,
              deletedAt: commentMessages.deletedAt,
            })
            .from(commentMessages)
            .where(eq(commentMessages.id, ctx.body.messageId));

          if (!msg) throw new CMSError('COMMENT_MESSAGE_NOT_FOUND');

          // IDOR: resolve the owning thread through the scope-enforcing
          // loader — a message id alone must not reach another scope's
          // thread. Also enforces the message's thread belongs to this
          // collection, matching the original hand-rolled JOIN's filter.
          await loadThreadInScope(
            tx,
            msg.threadId,
            collectionName,
            ctx.context.scope,
          );

          if (msg.deletedAt) throw new CMSError('COMMENT_MESSAGE_DELETED');
          if (msg.messageType !== 'comment') {
            throw new CMSError('COMMENT_MESSAGE_NOT_FOUND');
          }
          if (msg.authorId !== userId) {
            throw new CMSError('COMMENT_AUTHOR_MISMATCH');
          }

          const now = new Date();

          const [updated] = await tx
            .update(commentMessages)
            .set({
              body: ctx.body.body,
              editedAt: now,
              updatedAt: now,
            })
            .where(eq(commentMessages.id, msg.id))
            .returning();

          if (ctx.body.mentions !== undefined) {
            await tx
              .delete(commentMentions)
              .where(eq(commentMentions.messageId, msg.id));

            const resolved = resolveMentions(ctx.body.mentions, userId);
            await insertMentions(tx, msg.id, msg.threadId, userId, resolved);
          }

          const mentionRows = await tx
            .select({ mentionedUserId: commentMentions.mentionedUserId })
            .from(commentMentions)
            .where(eq(commentMentions.messageId, msg.id));

          return {
            message: mapMessage(
              updated,
              mentionRows.map((r) => r.mentionedUserId),
            ),
          };
        });
      },
    ),

    /**
     * Soft-deletes a comment message (body masked on retrieval).
     * Only the original author may delete; system messages cannot be deleted.
     * @param messageId Required message ID.
     * @returns { message } envelope with the soft-deleted message (body masked).
     * @throws USER_ID_REQUIRED if userId is not present.
     * @throws COMMENT_MESSAGE_NOT_FOUND if message does not exist.
     * @throws COMMENT_MESSAGE_DELETED if message is already deleted.
     * @throws COMMENT_AUTHOR_MISMATCH if userId is not the message author.
     * @example await cmsClient.pages.deleteCommentMessage({ messageId: 'm1' })
     */
    deleteCommentMessage: createCMSEndpoint(
      `/${collectionName}/deleteCommentMessage`,
      {
        method: 'POST',
        body: z.object({
          messageId: z.string(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              body: {} as { messageId: string },
            },
          },
          {
            permissionResource: 'comment',
            operation: 'delete',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const userId = ctx.context.userId;
        if (!userId) throw new CMSError('USER_ID_REQUIRED');

        const [msg] = await db
          .select({
            id: commentMessages.id,
            threadId: commentMessages.threadId,
            authorId: commentMessages.authorId,
            messageType: commentMessages.messageType,
            deletedAt: commentMessages.deletedAt,
          })
          .from(commentMessages)
          .where(eq(commentMessages.id, ctx.body.messageId));

        if (!msg) throw new CMSError('COMMENT_MESSAGE_NOT_FOUND');

        // IDOR: resolve the owning thread through the scope-enforcing loader
        // — a message id alone must not reach another scope's thread. Also
        // enforces the message's thread belongs to this collection, matching
        // the original hand-rolled JOIN's filter.
        await loadThreadInScope(
          db,
          msg.threadId,
          collectionName,
          ctx.context.scope,
        );

        if (msg.deletedAt) throw new CMSError('COMMENT_MESSAGE_DELETED');
        if (msg.messageType !== 'comment') {
          throw new CMSError('COMMENT_MESSAGE_NOT_FOUND');
        }
        if (msg.authorId !== userId) {
          throw new CMSError('COMMENT_AUTHOR_MISMATCH');
        }

        const now = new Date();

        const [updated] = await db
          .update(commentMessages)
          .set({
            deletedAt: now,
            updatedAt: now,
          })
          .where(eq(commentMessages.id, msg.id))
          .returning();

        return { message: mapMessage(updated) };
      },
    ),

    /**
     * Lists mentions received by the calling user, with pagination.
     * @param threadId Optional filter to mentions in a specific thread.
     * @param limit Page size (1–100, default 20).
     * @param offset Pagination offset (default 0).
     * @returns Paginated list of mentions with associated message and thread context.
     * @throws USER_ID_REQUIRED if userId is not present.
     * @example await cmsClient.pages.listMentions({ limit: 50 })
     */
    listMentions: createCMSEndpoint(
      `/${collectionName}/listMentions`,
      {
        method: 'GET',
        query: z
          .object({
            threadId: z.string().optional(),
            limit: z.coerce.number().min(1).max(100).optional(),
            offset: z.coerce.number().min(0).optional(),
          })
          .optional(),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                threadId?: string;
                limit?: number;
                offset?: number;
              },
            },
          },
          {
            permissionResource: 'comment',
            operation: 'read',
            scope: 'collection',
            collection: collectionName,
          },
        ),
      },
      async (ctx) => {
        const userId = ctx.context.userId;
        if (!userId) throw new CMSError('USER_ID_REQUIRED');

        const input = ctx.query ?? {};
        const limit = input.limit ?? 20;
        const offset = input.offset ?? 0;

        // Privacy: mentions are always filtered by the session user, never a
        // caller-supplied id — otherwise any caller with comment:read could
        // page through another user's mention inbox (message bodies
        // included).
        const conditions = [
          eq(commentMentions.mentionedUserId, userId),
          eq(commentThreads.collection, collectionName),
        ];

        if (input.threadId) {
          conditions.push(eq(commentMentions.threadId, input.threadId));
        }

        const whereCondition = and(...conditions)!;

        const [{ count }] = await db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(commentMentions)
          .innerJoin(
            commentThreads,
            eq(commentThreads.id, commentMentions.threadId),
          )
          .where(whereCondition);

        const rows = await db
          .select({
            mention: commentMentions,
            message: commentMessages,
            thread: commentThreads,
          })
          .from(commentMentions)
          .innerJoin(
            commentMessages,
            eq(commentMessages.id, commentMentions.messageId),
          )
          .innerJoin(
            commentThreads,
            eq(commentThreads.id, commentMentions.threadId),
          )
          .where(whereCondition)
          .orderBy(desc(commentMentions.createdAt))
          .limit(limit)
          .offset(offset);

        // Batch-load mentions for the page's messages so each returned message
        // carries its full mention list (a mention row proves >=1 exists).
        const mentionsMap = await loadMentionsByMessageIds(
          db,
          rows.map((r) => r.message.id),
        );

        return {
          mentions: rows.map((r) => ({
            id: r.mention.id,
            mentionedUserId: r.mention.mentionedUserId,
            mentionedBy: r.mention.mentionedBy,
            createdAt: new Date(r.mention.createdAt),
            message: mapMessage(r.message, mentionsMap.get(r.message.id) ?? []),
            thread: mapThread(r.thread),
          })),
          total: count,
          hasMore: offset + rows.length < count,
        };
      },
    ),
  };
}

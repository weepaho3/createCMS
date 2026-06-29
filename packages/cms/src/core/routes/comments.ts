import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import type { NotificationInput } from '../notifications/types';
import type { CollectionWithName, CMSProcedureCtx } from '../types';
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
import { flushNotifications } from '../notifications/service';
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

export function createCommentEndpoints<TDef extends CollectionWithName>(
  def: TDef,
  cmsCtx: CMSProcedureCtx,
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
     * @param mergeRequestId Root ID extracted from this merge request if targetType is 'mergeRequest'.
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

        const pending: NotificationInput[] = [];

        return db
          .transaction(async (tx) => {
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
          })
          .then((result) => {
            flushNotifications(cmsCtx.notificationService, pending);
            return result;
          });
      },
    ),

    /**
     * Adds a reply (with optional nesting) to an existing comment thread.
     * @param threadId Required thread ID.
     * @param body Comment text; non-empty required.
     * @param parentMessageId Optional parent message ID for nested replies.
     * @param mentions Array of user IDs to mention in this message (optional).
     * @returns Message output with resolved mentions; notifies thread creator and all mentioned users.
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

        const pending: NotificationInput[] = [];

        return db
          .transaction(async (tx) => {
            const [thread] = await tx
              .select({
                id: commentThreads.id,
                rootId: commentThreads.rootId,
                collection: commentThreads.collection,
                createdBy: commentThreads.createdBy,
              })
              .from(commentThreads)
              .where(
                and(
                  eq(commentThreads.id, input.threadId),
                  eq(commentThreads.collection, collectionName),
                ),
              );

            if (!thread) throw new CMSError('COMMENT_THREAD_NOT_FOUND');

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

            return mapMessage(message, resolved);
          })
          .then((result) => {
            flushNotifications(cmsCtx.notificationService, pending);
            return result;
          });
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

        const whereCondition = and(...conditions)!;

        const enrich = userEnrichment(ctx, COMMENT_THREAD_USER_FIELDS);

        const [{ count }] = await db
          .select({ count: sql<number>`count(*)`.mapWith(Number) })
          .from(commentThreads)
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
          ${enrich.join}
          WHERE ${whereCondition}
          ORDER BY ${commentThreads.createdAt} DESC
          LIMIT ${limit} OFFSET ${offset}
        `);

        const rawRows = dataResult.rows as Array<Record<string, unknown>>;
        const threadIds = rawRows.map((r) => r.id as string);

        let messageSummaries: Record<
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

          const commentFilter = and(
            inArray(commentMessages.threadId, threadIds),
            eq(commentMessages.messageType, 'comment'),
            isNull(commentMessages.deletedAt),
          );

          const firstMessages = await db
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
                  ORDER BY ${commentMessages.threadId}, ${commentMessages.createdAt} ASC
                )`,
              ),
            );

          const latestMessages = await db
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
                  ORDER BY ${commentMessages.threadId}, ${commentMessages.createdAt} DESC
                )`,
              ),
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

        const threadOutput: Record<string, unknown> = {
          id: threadRow.id,
          rootId: threadRow.root_id,
          collection: threadRow.collection,
          targetType: threadRow.target_type,
          mergeRequestId: threadRow.merge_request_id,
          blockId: threadRow.block_id,
          commitId: threadRow.commit_id,
          status: threadRow.status,
          resolvedBy: threadRow.resolved_by,
          resolvedAt: parseTimestampOrNull(threadRow.resolved_at),
          createdBy: threadRow.created_by,
          createdAt: parseTimestamp(threadRow.created_at),
          updatedAt: parseTimestamp(threadRow.updated_at),
        };

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
     * @returns Updated thread object and the system message indicating resolution.
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

        const pending: NotificationInput[] = [];

        return db
          .transaction(async (tx) => {
            const [thread] = await tx
              .select()
              .from(commentThreads)
              .where(
                and(
                  eq(commentThreads.id, ctx.body.threadId),
                  eq(commentThreads.collection, collectionName),
                ),
              )
              .for('update');

            if (!thread) throw new CMSError('COMMENT_THREAD_NOT_FOUND');
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
              systemMessage: mapMessage(systemMsg),
            };
          })
          .then((result) => {
            flushNotifications(cmsCtx.notificationService, pending);
            return result;
          });
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
          const [thread] = await tx
            .select({
              id: commentThreads.id,
              rootId: commentThreads.rootId,
            })
            .from(commentThreads)
            .where(
              and(
                eq(commentThreads.id, ctx.body.threadId),
                eq(commentThreads.collection, collectionName),
                isNull(commentThreads.deletedAt),
              ),
            )
            .for('update');

          if (!thread) throw new CMSError('COMMENT_THREAD_NOT_FOUND');

          // IDOR: when the thread is attached to a root, enforce the active
          // scope on that root (root-less threads fall back to collection
          // scoping, matching the sibling comment endpoints).
          if (thread.rootId) {
            await requireRootInScope(
              tx,
              thread.rootId,
              collectionName,
              ctx.context.scope.roots,
              'COMMENT_THREAD_NOT_FOUND',
            );
          }

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
     * @returns Updated thread object and the system message indicating reopening.
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

        const pending: NotificationInput[] = [];

        return db
          .transaction(async (tx) => {
            const [thread] = await tx
              .select()
              .from(commentThreads)
              .where(
                and(
                  eq(commentThreads.id, ctx.body.threadId),
                  eq(commentThreads.collection, collectionName),
                ),
              )
              .for('update');

            if (!thread) throw new CMSError('COMMENT_THREAD_NOT_FOUND');
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
                type: 'threadResolved',
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
              systemMessage: mapMessage(systemMsg),
            };
          })
          .then((result) => {
            flushNotifications(cmsCtx.notificationService, pending);
            return result;
          });
      },
    ),

    /**
     * Updates a comment message body and optionally re-sets mentions.
     * Only the original author may edit; system messages cannot be edited.
     * @param messageId Required message ID.
     * @param body New comment text; non-empty required.
     * @param mentions Optional array of user IDs to re-mention (replaces old mentions).
     * @returns Updated message output with current mentions.
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
            .innerJoin(
              commentThreads,
              eq(commentThreads.id, commentMessages.threadId),
            )
            .where(
              and(
                eq(commentMessages.id, ctx.body.messageId),
                eq(commentThreads.collection, collectionName),
              ),
            );

          if (!msg) throw new CMSError('COMMENT_MESSAGE_NOT_FOUND');
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

          return mapMessage(
            updated,
            mentionRows.map((r) => r.mentionedUserId),
          );
        });
      },
    ),

    /**
     * Soft-deletes a comment message (body masked on retrieval).
     * Only the original author may delete; system messages cannot be deleted.
     * @param messageId Required message ID.
     * @returns Deleted message output.
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
            operation: 'update',
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
          .innerJoin(
            commentThreads,
            eq(commentThreads.id, commentMessages.threadId),
          )
          .where(
            and(
              eq(commentMessages.id, ctx.body.messageId),
              eq(commentThreads.collection, collectionName),
            ),
          );

        if (!msg) throw new CMSError('COMMENT_MESSAGE_NOT_FOUND');
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

        return mapMessage(updated);
      },
    ),

    /**
     * Lists all mentions received by a user with pagination.
     * @param mentionedUserId Required user ID to list mentions for.
     * @param threadId Optional filter to mentions in a specific thread.
     * @param limit Page size (1–100, default 20).
     * @param offset Pagination offset (default 0).
     * @returns Paginated list of mentions with associated message and thread context.
     * @example await cmsClient.pages.listMentions({ mentionedUserId: 'user1', limit: 50 })
     */
    listMentions: createCMSEndpoint(
      `/${collectionName}/listMentions`,
      {
        method: 'GET',
        query: z.object({
          mentionedUserId: z.string(),
          threadId: z.string().optional(),
          limit: z.coerce.number().min(1).max(100).optional(),
          offset: z.coerce.number().min(0).optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                mentionedUserId: string;
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
        const input = ctx.query;
        const limit = input.limit ?? 20;
        const offset = input.offset ?? 0;

        const conditions = [
          eq(commentMentions.mentionedUserId, input.mentionedUserId),
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

        return {
          mentions: rows.map((r) => ({
            id: r.mention.id,
            mentionedUserId: r.mention.mentionedUserId,
            mentionedBy: r.mention.mentionedBy,
            createdAt: new Date(r.mention.createdAt),
            message: mapMessage(r.message),
            thread: mapThread(r.thread),
          })),
          total: count,
          hasMore: offset + rows.length < count,
        };
      },
    ),
  };
}

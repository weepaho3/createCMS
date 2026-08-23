import { sql } from 'drizzle-orm';

import type { DrizzleInstance } from '../types/drizzle';

import { ROOT_SLUG_PROP } from '../blocks/reconstruct-snapshot';
import { DEFAULT_BRANCH_NAME } from '../branch-policy';
import {
  assets,
  blockVersions,
  branches,
  commentMessages,
  commentThreads,
  commitSnapshots,
  mergeRequests,
  notifications,
  roots,
  searchIndex,
  templates,
  variables,
} from '../db/schema.generated';

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}...`;
}

async function upsertSearchIndex(
  db: DrizzleInstance,
  params: {
    entityType: string;
    entityId: string;
    collection?: string | null;
    rootId?: string | null;
    textParts: { text: string; weight: 'A' | 'B' | 'C' | 'D' }[];
    title?: string | null;
    snippet?: string | null;
    meta?: Record<string, unknown> | null;
  },
): Promise<void> {
  const {
    entityType,
    entityId,
    collection,
    rootId,
    textParts,
    title,
    snippet,
    meta,
  } = params;

  if (textParts.length === 0) return;

  const vectorParts = textParts.map(
    (part) =>
      sql`setweight(to_tsvector('simple', ${part.text}), ${sql.raw(`'${part.weight}'`)})`,
  );

  let combinedVector = vectorParts[0]!;
  for (let i = 1; i < vectorParts.length; i++) {
    combinedVector = sql`${combinedVector} || ${vectorParts[i]}`;
  }

  // Use the query builder rather than hand-rolled SQL: a raw INSERT/ON
  // CONFLICT/DO UPDATE with `${searchIndex.col}` renders schema-qualified
  // column names (`"cms"."search_index"."id"`), which Postgres rejects in
  // INSERT column lists, ON CONFLICT targets, and SET targets. The builder
  // emits bare column names. The tsvector is passed as a sql expression value.
  const values = {
    entityType,
    entityId,
    collection: collection ?? null,
    rootId: rootId ?? null,
    contentVector: combinedVector,
    title: title ?? null,
    snippet: snippet ?? null,
    meta: meta ?? null,
    updatedAt: new Date(),
  };

  await db
    .insert(searchIndex)
    .values(values)
    .onConflictDoUpdate({
      target: [searchIndex.entityType, searchIndex.entityId],
      set: {
        collection: values.collection,
        rootId: values.rootId,
        contentVector: combinedVector,
        title: values.title,
        snippet: values.snippet,
        meta: values.meta,
        updatedAt: values.updatedAt,
      },
    });
}

async function deleteSearchIndex(
  db: DrizzleInstance,
  entityType: string,
  entityId: string,
): Promise<void> {
  await db.execute(sql`
    DELETE FROM ${searchIndex}
    WHERE ${searchIndex.entityType} = ${entityType}
      AND ${searchIndex.entityId} = ${entityId}
  `);
}

/**
 * Index a root and all its blocks at the HEAD of the main branch.
 * The root block gets weight A for title-like props, B for others.
 * Child blocks get weight C.
 */
export async function indexRoot(
  db: DrizzleInstance,
  rootId: string,
  defaultBranchName: string = DEFAULT_BRANCH_NAME,
): Promise<void> {
  const rootRow = await db.execute(sql`
    SELECT ${roots.id}, ${roots.collection}, ${roots.slug}
    FROM ${roots}
    WHERE ${roots.id} = ${rootId}
    LIMIT 1
  `);

  if (rootRow.rows.length === 0) return;

  const root = rootRow.rows[0] as {
    id: string;
    collection: string;
    slug: string | null;
  };

  const mainBranch = await db.execute(sql`
    SELECT ${branches.headCommitId}
    FROM ${branches}
    WHERE ${branches.rootId} = ${rootId}
      AND ${branches.name} = ${defaultBranchName}
    LIMIT 1
  `);

  if (mainBranch.rows.length === 0) return;

  const headCommitId = (mainBranch.rows[0] as { head_commit_id: string })
    .head_commit_id;

  const blockRows = await db.execute(sql`
    SELECT
      ${commitSnapshots.blockId} AS block_id,
      ${blockVersions.type} AS type,
      ${blockVersions.properties} AS properties,
      ${blockVersions.deleted} AS deleted
    FROM ${commitSnapshots}
    JOIN ${blockVersions}
      ON ${blockVersions.id} = ${commitSnapshots.blockVersionId}
    WHERE ${commitSnapshots.commitId} = ${headCommitId}
      AND ${blockVersions.rootId} = ${rootId}
  `);

  const textParts: { text: string; weight: 'A' | 'B' | 'C' | 'D' }[] = [];
  let titleText: string | null = null;
  let snippetText: string | null = null;

  for (const row of blockRows.rows as Array<{
    block_id: string;
    type: string;
    properties: Record<string, unknown>;
    deleted: boolean;
  }>) {
    if (row.deleted) continue;
    const props = row.properties;
    const isRootBlock = row.block_id === rootId;

    for (const [key, value] of Object.entries(props)) {
      // The reserved `__slug` draft key is not user content, so never index
      // it. The published `roots.slug` is indexed separately below.
      if (key === ROOT_SLUG_PROP) continue;
      if (typeof value !== 'string' || value.trim().length === 0) continue;

      if (isRootBlock) {
        const isTitle = key === 'title' || key === 'name';
        textParts.push({
          text: value,
          weight: isTitle ? 'A' : 'B',
        });
        if (isTitle && !titleText) {
          titleText = value;
        }
        if (!snippetText && !isTitle) {
          snippetText = truncate(value, 200);
        }
      } else {
        textParts.push({ text: value, weight: 'C' });
        if (!snippetText) {
          snippetText = truncate(value, 200);
        }
      }
    }
  }

  if (root.slug) {
    textParts.push({ text: root.slug, weight: 'B' });
  }

  if (textParts.length === 0) return;

  await upsertSearchIndex(db, {
    entityType: 'root',
    entityId: rootId,
    collection: root.collection,
    rootId,
    textParts,
    title: titleText ?? root.slug,
    snippet: snippetText,
    meta: { slug: root.slug, collection: root.collection },
  });
}

/**
 * Index a comment message body.
 */
export async function indexComment(
  db: DrizzleInstance,
  messageId: string,
): Promise<void> {
  const result = await db.execute(sql`
    SELECT
      ${commentMessages.id},
      ${commentMessages.body},
      ${commentMessages.deletedAt},
      ${commentThreads.collection},
      ${commentThreads.rootId}
    FROM ${commentMessages}
    JOIN ${commentThreads}
      ON ${commentThreads.id} = ${commentMessages.threadId}
    WHERE ${commentMessages.id} = ${messageId}
    LIMIT 1
  `);

  if (result.rows.length === 0) return;

  const row = result.rows[0] as {
    id: string;
    body: string | null;
    deleted_at: string | null;
    collection: string;
    root_id: string | null;
  };

  if (row.deleted_at || !row.body || row.body.trim().length === 0) {
    await deleteSearchIndex(db, 'comment', messageId);
    return;
  }

  await upsertSearchIndex(db, {
    entityType: 'comment',
    entityId: messageId,
    collection: row.collection,
    rootId: row.root_id,
    textParts: [{ text: row.body, weight: 'B' }],
    title: truncate(row.body, 80),
    snippet: truncate(row.body, 200),
    meta: { collection: row.collection },
  });
}

/**
 * Index a merge request title + description.
 */
export async function indexMergeRequest(
  db: DrizzleInstance,
  mrId: string,
): Promise<void> {
  const result = await db.execute(sql`
    SELECT
      ${mergeRequests.id},
      ${mergeRequests.title},
      ${mergeRequests.description},
      ${mergeRequests.rootId},
      ${roots.collection}
    FROM ${mergeRequests}
    JOIN ${roots} ON ${roots.id} = ${mergeRequests.rootId}
    WHERE ${mergeRequests.id} = ${mrId}
    LIMIT 1
  `);

  if (result.rows.length === 0) return;

  const row = result.rows[0] as {
    id: string;
    title: string | null;
    description: string | null;
    root_id: string;
    collection: string;
  };

  const textParts: { text: string; weight: 'A' | 'B' | 'C' | 'D' }[] = [];
  if (row.title) textParts.push({ text: row.title, weight: 'A' });
  if (row.description) textParts.push({ text: row.description, weight: 'B' });

  if (textParts.length === 0) return;

  await upsertSearchIndex(db, {
    entityType: 'mergeRequest',
    entityId: mrId,
    collection: row.collection,
    rootId: row.root_id,
    textParts,
    title: row.title,
    snippet: row.description ? truncate(row.description, 200) : null,
    meta: { collection: row.collection, rootId: row.root_id },
  });
}

/**
 * Index a variable key + value + description.
 */
export async function indexVariable(
  db: DrizzleInstance,
  variableId: string,
): Promise<void> {
  const result = await db.execute(sql`
    SELECT ${variables.id}, ${variables.key}, ${variables.value}, ${variables.description}
    FROM ${variables}
    WHERE ${variables.id} = ${variableId}
    LIMIT 1
  `);

  if (result.rows.length === 0) return;

  const row = result.rows[0] as {
    id: string;
    key: string;
    value: string;
    description: string | null;
  };

  const textParts: { text: string; weight: 'A' | 'B' | 'C' | 'D' }[] = [
    { text: row.key, weight: 'A' },
    { text: row.value, weight: 'B' },
  ];
  if (row.description) {
    textParts.push({ text: row.description, weight: 'B' });
  }

  await upsertSearchIndex(db, {
    entityType: 'variable',
    entityId: variableId,
    collection: null,
    rootId: null,
    textParts,
    title: row.key,
    snippet: truncate(row.value, 200),
    meta: { key: row.key },
  });
}

/**
 * Index a template.
 */
export async function indexTemplate(
  db: DrizzleInstance,
  templateId: string,
): Promise<void> {
  const result = await db.execute(sql`
    SELECT
      ${templates.id}, ${templates.collection}, ${templates.blockType},
      ${templates.propertyKey}, ${templates.template}, ${templates.description}
    FROM ${templates}
    WHERE ${templates.id} = ${templateId}
    LIMIT 1
  `);

  if (result.rows.length === 0) return;

  const row = result.rows[0] as {
    id: string;
    collection: string;
    block_type: string;
    property_key: string;
    template: string;
    description: string | null;
  };

  const textParts: { text: string; weight: 'A' | 'B' | 'C' | 'D' }[] = [
    {
      text: `${row.collection} ${row.block_type} ${row.property_key}`,
      weight: 'A',
    },
    { text: row.template, weight: 'B' },
  ];
  if (row.description) {
    textParts.push({ text: row.description, weight: 'B' });
  }

  await upsertSearchIndex(db, {
    entityType: 'template',
    entityId: templateId,
    collection: row.collection,
    rootId: null,
    textParts,
    title: `${row.collection}.${row.block_type}.${row.property_key}`,
    snippet: truncate(row.template, 200),
    meta: {
      collection: row.collection,
      blockType: row.block_type,
      propertyKey: row.property_key,
    },
  });
}

/**
 * Index an asset slug.
 */
export async function indexAsset(
  db: DrizzleInstance,
  assetId: string,
): Promise<void> {
  const result = await db.execute(sql`
    SELECT ${assets.id}, ${assets.slug}, ${assets.mimeType}
    FROM ${assets}
    WHERE ${assets.id} = ${assetId}
    LIMIT 1
  `);

  if (result.rows.length === 0) return;

  const row = result.rows[0] as {
    id: string;
    slug: string;
    mime_type: string;
  };

  await upsertSearchIndex(db, {
    entityType: 'asset',
    entityId: assetId,
    collection: null,
    rootId: null,
    textParts: [
      { text: row.slug, weight: 'A' },
      { text: row.mime_type, weight: 'C' },
    ],
    title: row.slug,
    snippet: row.mime_type,
    meta: { slug: row.slug, mimeType: row.mime_type },
  });
}

/**
 * Index a notification title + body.
 */
export async function indexNotification(
  db: DrizzleInstance,
  notificationId: string,
): Promise<void> {
  const result = await db.execute(sql`
    SELECT ${notifications.id}, ${notifications.title}, ${notifications.body}, ${notifications.collection}, ${notifications.recipientId}
    FROM ${notifications}
    WHERE ${notifications.id} = ${notificationId}
    LIMIT 1
  `);

  if (result.rows.length === 0) return;

  const row = result.rows[0] as {
    id: string;
    title: string;
    body: string | null;
    collection: string | null;
    recipient_id: string;
  };

  const textParts: { text: string; weight: 'A' | 'B' | 'C' | 'D' }[] = [
    { text: row.title, weight: 'A' },
  ];
  if (row.body) textParts.push({ text: row.body, weight: 'B' });

  await upsertSearchIndex(db, {
    entityType: 'notification',
    entityId: notificationId,
    collection: row.collection,
    rootId: null,
    textParts,
    title: row.title,
    snippet: row.body ? truncate(row.body, 200) : null,
    // `recipientId` is the per-user visibility key: the search endpoint only
    // returns a 'notification' row when `meta.recipientId === ctx userId`.
    // Without it a reindex would make every notification's title/body
    // searchable across users.
    meta: { collection: row.collection, recipientId: row.recipient_id },
  });
}

/**
 * Delete all search index entries for a given entity.
 */
export { deleteSearchIndex };

export async function reindexAll(
  db: DrizzleInstance,
  defaultBranchName: string = DEFAULT_BRANCH_NAME,
): Promise<{
  indexed: Record<string, number>;
}> {
  const counts: Record<string, number> = {
    root: 0,
    comment: 0,
    mergeRequest: 0,
    variable: 0,
    template: 0,
    asset: 0,
    notification: 0,
  };

  // Clear existing index
  await db.execute(sql`DELETE FROM ${searchIndex}`);

  // Roots
  const rootRows = await db.execute(sql`
    SELECT ${roots.id} FROM ${roots}
  `);
  for (const row of rootRows.rows as Array<{ id: string }>) {
    await indexRoot(db, row.id, defaultBranchName);
    counts.root++;
  }

  // Comments
  const commentRows = await db.execute(sql`
    SELECT ${commentMessages.id}
    FROM ${commentMessages}
    WHERE ${commentMessages.messageType} = 'comment'
      AND ${commentMessages.deletedAt} IS NULL
  `);
  for (const row of commentRows.rows as Array<{ id: string }>) {
    await indexComment(db, row.id);
    counts.comment++;
  }

  // Merge requests
  const mrRows = await db.execute(sql`
    SELECT ${mergeRequests.id} FROM ${mergeRequests}
  `);
  for (const row of mrRows.rows as Array<{ id: string }>) {
    await indexMergeRequest(db, row.id);
    counts.mergeRequest++;
  }

  // Variables
  const varRows = await db.execute(sql`
    SELECT ${variables.id} FROM ${variables}
  `);
  for (const row of varRows.rows as Array<{ id: string }>) {
    await indexVariable(db, row.id);
    counts.variable++;
  }

  // Templates
  const tplRows = await db.execute(sql`
    SELECT ${templates.id} FROM ${templates}
  `);
  for (const row of tplRows.rows as Array<{ id: string }>) {
    await indexTemplate(db, row.id);
    counts.template++;
  }

  // Assets
  const assetRows = await db.execute(sql`
    SELECT ${assets.id} FROM ${assets}
  `);
  for (const row of assetRows.rows as Array<{ id: string }>) {
    await indexAsset(db, row.id);
    counts.asset++;
  }

  // Notifications
  const ntfRows = await db.execute(sql`
    SELECT ${notifications.id} FROM ${notifications}
  `);
  for (const row of ntfRows.rows as Array<{ id: string }>) {
    await indexNotification(db, row.id);
    counts.notification++;
  }

  return { indexed: counts };
}

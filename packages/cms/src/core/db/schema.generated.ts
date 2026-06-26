/* eslint-disable */
/**
 * GENERATED from core-schema.ts by scripts/generate-schema.ts.
 * Run `bun run generate:schema` to regenerate.
 * Do not edit manually.
 */

import { sql } from 'drizzle-orm';
import { boolean, customType, foreignKey, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { newId } from '../../utils/nanoid';

export const cms = pgSchema('cms');

const tsvectorColumn = customType<{ data: string }>({
  dataType() { return 'tsvector'; },
});
export const approvalStatusEnum = cms.enum("approval_status", ["pending", "approved", "rejected"]);

export const assetStatusEnum = cms.enum("asset_status", ["private", "public"]);

export const commentMessageTypeEnum = cms.enum("comment_message_type", ["comment", "system"]);

export const commentSystemTypeEnum = cms.enum("comment_system_type", ["threadResolved", "threadReopened"]);

export const commentThreadStatusEnum = cms.enum("comment_thread_status", ["open", "resolved"]);

export const commentThreadTargetEnum = cms.enum("comment_thread_target", ["mergeRequest", "block"]);

export const conflictResolutionEnum = cms.enum("conflict_resolution", ["source", "target", "manual"]);

export const contentUsageTargetEnum = cms.enum("content_usage_target", ["asset", "variable", "reference"]);

export const mergeRequestStatusEnum = cms.enum("merge_request_status", ["open", "merged", "closed"]);

export const notificationTypeEnum = cms.enum("notification_type", ["mention", "comment", "threadResolved", "approvalRequested", "approvalApproved", "approvalRejected", "mergeRequestOpened", "mergeRequestMerged", "mergeRequestClosed", "mergeRequestReopened", "published", "custom"]);

export const redirectEndpointTypeEnum = cms.enum("redirect_endpoint_type", ["page", "path"]);

export const approvals = cms.table(
  "approvals",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("approval")),
    mergeRequestId: text("merge_request_id").references(() => mergeRequests.id, { onDelete: "cascade" }),
    branchId: text("branch_id").notNull().references(() => branches.id),
    commitId: text("commit_id").notNull().references(() => commits.id),
    status: approvalStatusEnum("status").notNull().default("pending"),
    requestedBy: text("requested_by").notNull(),
    requestedReviewer: text("requested_reviewer").notNull(),
    reviewedBy: text("reviewed_by"),
    message: text("message"),
    rejectionReason: text("rejection_reason"),
    reviewedAt: timestamp("reviewed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("approvals_mr_idx").on(table.mergeRequestId),
    index("approvals_branch_idx").on(table.branchId),
    index("approvals_branch_commit_idx").on(table.branchId, table.commitId),
    index("approvals_status_idx").on(table.status),
    index("approvals_requested_reviewer_idx").on(table.requestedReviewer),
    uniqueIndex("approvals_target_reviewer_unique").on(table.mergeRequestId, table.branchId, table.commitId, table.requestedReviewer),
  ],
);

export const assetFolders = cms.table(
  "asset_folders",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("assetFolder")),
    name: text("name").notNull(),
    parentId: text("parent_id"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: "asset_folders_parent_fk",
    }).onDelete("cascade"),
    index("asset_folders_parent_idx").on(table.parentId),
    uniqueIndex("asset_folders_name_unique").on(table.parentId, table.name),
  ],
);

export const assets = cms.table(
  "assets",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("asset")),
    slug: text("slug").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    objectKey: text("object_key").notNull(),
    status: assetStatusEnum("status").notNull().default("private"),
    folderId: text("folder_id").references(() => assetFolders.id, { onDelete: "set null" }),
    variantOf: text("variant_of").references((): AnyPgColumn => assets.id, { onDelete: "set null" }),
    uploadedBy: text("uploaded_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    index("assets_folder_idx").on(table.folderId),
    index("assets_status_idx").on(table.status),
    index("assets_variant_of_idx").on(table.variantOf),
    uniqueIndex("assets_object_key_unique").on(table.objectKey),
    uniqueIndex("assets_slug_unique").on(table.slug),
  ],
);

export const blockVersions = cms.table(
  "block_versions",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("blockVersion")),
    blockId: text("block_id").notNull(),
    rootId: text("root_id").notNull().references(() => roots.id),
    commitId: text("commit_id").notNull().references(() => commits.id),
    type: text("type").notNull(),
    properties: jsonb("properties").$type<Record<string, unknown>>().notNull(),
    children: jsonb("children").$type<string[]>().notNull().default([]),
    deleted: boolean("deleted").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("bv_block_id_idx").on(table.blockId),
    index("bv_commit_id_idx").on(table.commitId),
    index("bv_root_id_idx").on(table.rootId),
    uniqueIndex("bv_block_commit_unique").on(table.blockId, table.commitId),
    index("bv_properties_gin").using("gin", table.properties),
  ],
);

export const branches = cms.table(
  "branches",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("branch")),
    rootId: text("root_id").notNull().references(() => roots.id),
    name: text("name").notNull(),
    headCommitId: text("head_commit_id").notNull().references(() => commits.id),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("branches_root_id_idx").on(table.rootId),
    uniqueIndex("branches_root_name_unique").on(table.rootId, table.name),
  ],
);

export const commentMentions = cms.table(
  "comment_mentions",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("commentMention")),
    messageId: text("message_id").notNull().references(() => commentMessages.id, { onDelete: "cascade" }),
    threadId: text("thread_id").notNull().references(() => commentThreads.id, { onDelete: "cascade" }),
    mentionedUserId: text("mentioned_user_id").notNull(),
    mentionedBy: text("mentioned_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("cmn_user_idx").on(table.mentionedUserId, table.createdAt),
    index("cmn_message_idx").on(table.messageId),
    index("cmn_thread_user_idx").on(table.threadId, table.mentionedUserId),
    uniqueIndex("cmn_message_user_unique").on(table.messageId, table.mentionedUserId),
  ],
);

export const commentMessages = cms.table(
  "comment_messages",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("commentMessage")),
    threadId: text("thread_id").notNull().references(() => commentThreads.id, { onDelete: "cascade" }),
    parentMessageId: text("parent_message_id"),
    authorId: text("author_id"),
    messageType: commentMessageTypeEnum("message_type").notNull().default("comment"),
    systemType: commentSystemTypeEnum("system_type"),
    body: text("body"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    editedAt: timestamp("edited_at"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.parentMessageId],
      foreignColumns: [table.id],
      name: "comment_messages_parent_fk",
    }).onDelete("set null"),
    index("cm_thread_idx").on(table.threadId, table.createdAt),
    index("cm_parent_idx").on(table.parentMessageId),
    index("cm_type_idx").on(table.messageType, table.systemType),
    index("cm_author_idx").on(table.authorId, table.createdAt),
  ],
);

export const commentThreads = cms.table(
  "comment_threads",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("commentThread")),
    rootId: text("root_id").references(() => roots.id, { onDelete: "cascade" }),
    collection: text("collection").notNull(),
    targetType: commentThreadTargetEnum("target_type").notNull(),
    mergeRequestId: text("merge_request_id").references(() => mergeRequests.id, { onDelete: "cascade" }),
    blockId: text("block_id"),
    commitId: text("commit_id").references(() => commits.id, { onDelete: "set null" }),
    status: commentThreadStatusEnum("status").notNull().default("open"),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("ct_collection_idx").on(table.collection, table.createdAt),
    index("ct_mr_idx").on(table.mergeRequestId, table.createdAt),
    index("ct_block_idx").on(table.blockId, table.createdAt),
    index("ct_commit_idx").on(table.commitId, table.createdAt),
    index("ct_root_idx").on(table.rootId, table.createdAt),
    index("ct_status_idx").on(table.status),
  ],
);

export const commits = cms.table(
  "commits",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("commit")),
    rootId: text("root_id").notNull().references(() => roots.id),
    parentCommitId: text("parent_commit_id"),
    mergeSourceCommitId: text("merge_source_commit_id"),
    message: text("message"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    branchId: text("branch_id"),
    originBranchName: text("origin_branch_name").notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.parentCommitId],
      foreignColumns: [table.id],
      name: "commits_parent_fk",
    }),
    foreignKey({
      columns: [table.mergeSourceCommitId],
      foreignColumns: [table.id],
      name: "commits_merge_source_fk",
    }),
    index("commits_parent_idx").on(table.parentCommitId),
    index("commits_merge_source_idx").on(table.mergeSourceCommitId),
    index("commits_root_created_idx").on(table.rootId, table.createdAt),
    index("commits_branch_idx").on(table.branchId),
  ],
);

export const commitSnapshots = cms.table(
  "commit_snapshots",
  {
    commitId: text("commit_id").notNull().references(() => commits.id, { onDelete: "cascade" }),
    blockId: text("block_id").notNull(),
    blockVersionId: text("block_version_id").notNull().references(() => blockVersions.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.commitId, table.blockId] }),
    index("cs_block_version_idx").on(table.blockVersionId),
  ],
);

export const contentUsages = cms.table(
  "content_usages",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("contentUsage")),
    targetKind: contentUsageTargetEnum("target_kind").notNull(),
    targetKey: text("target_key").notNull(),
    blockVersionId: text("block_version_id").notNull().references(() => blockVersions.id, { onDelete: "cascade" }),
    rootId: text("root_id").notNull().references(() => roots.id, { onDelete: "cascade" }),
    blockId: text("block_id").notNull(),
    propertyKey: text("property_key").notNull(),
  },
  (table) => [
    uniqueIndex("cu_version_target_prop_unique").on(table.blockVersionId, table.targetKind, table.targetKey, table.propertyKey),
    index("cu_target_idx").on(table.targetKind, table.targetKey),
    index("cu_block_version_idx").on(table.blockVersionId),
    index("cu_root_idx").on(table.rootId),
  ],
);

export const mergeConflicts = cms.table(
  "merge_conflicts",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("mergeConflict")),
    mergeRequestId: text("merge_request_id").notNull().references(() => mergeRequests.id, { onDelete: "cascade" }),
    blockId: text("block_id").notNull(),
    sourceVersionId: text("source_version_id").references(() => blockVersions.id),
    targetVersionId: text("target_version_id").references(() => blockVersions.id),
    baseVersionId: text("base_version_id").references(() => blockVersions.id),
    resolution: conflictResolutionEnum("resolution"),
    resolvedVersionId: text("resolved_version_id").references(() => blockVersions.id),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("mc_merge_request_idx").on(table.mergeRequestId),
    uniqueIndex("mc_merge_block_unique").on(table.mergeRequestId, table.blockId),
  ],
);

export const mergeRequests = cms.table(
  "merge_requests",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("mergeRequest")),
    rootId: text("root_id").notNull().references(() => roots.id),
    sourceBranchId: text("source_branch_id").notNull().references(() => branches.id),
    targetBranchId: text("target_branch_id").notNull().references(() => branches.id),
    sourceCommitId: text("source_commit_id").notNull().references(() => commits.id),
    baseCommitId: text("base_commit_id").references(() => commits.id),
    mergeCommitId: text("merge_commit_id").references(() => commits.id),
    status: mergeRequestStatusEnum("status").notNull().default("open"),
    title: text("title"),
    description: text("description"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("mr_root_idx").on(table.rootId),
    index("mr_source_branch_idx").on(table.sourceBranchId),
    index("mr_target_branch_idx").on(table.targetBranchId),
    index("mr_status_idx").on(table.status),
    uniqueIndex("mr_open_source_target_unique").on(table.sourceBranchId, table.targetBranchId).where(sql`status = 'open'`),
  ],
);

export const notifications = cms.table(
  "notifications",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("notification")),
    recipientId: text("recipient_id").notNull(),
    actorId: text("actor_id"),
    type: notificationTypeEnum("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    collection: text("collection"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    readAt: timestamp("read_at"),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("ntf_recipient_created_idx").on(table.recipientId, table.createdAt),
    index("ntf_recipient_unread_idx").on(table.recipientId, table.readAt),
    index("ntf_resource_idx").on(table.resourceType, table.resourceId),
    index("ntf_type_idx").on(table.type),
  ],
);

export const publications = cms.table(
  "publications",
  {
    rootId: text("root_id").notNull().references(() => roots.id),
    branchId: text("branch_id").notNull().references(() => branches.id),
    commitId: text("commit_id").notNull().references(() => commits.id),
    publishedBy: text("published_by").notNull(),
    publishedAt: timestamp("published_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.rootId, table.branchId] }),
    index("publications_branch_idx").on(table.branchId),
  ],
);

export const redirects = cms.table(
  "redirects",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("redirect")),
    collection: text("collection").notNull(),
    sourceType: redirectEndpointTypeEnum("source_type").notNull(),
    sourceRootId: text("source_root_id").references(() => roots.id, { onDelete: "cascade" }),
    sourcePath: text("source_path"),
    targetType: redirectEndpointTypeEnum("target_type").notNull(),
    targetRootId: text("target_root_id").references(() => roots.id, { onDelete: "cascade" }),
    targetPath: text("target_path"),
    statusCode: integer("status_code").notNull().default(301),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    archivedAt: timestamp("archived_at"),
  },
  (table) => [
    index("rdr_collection_source_path_idx").on(table.collection, table.sourcePath),
    index("rdr_source_root_idx").on(table.sourceRootId),
    index("rdr_collection_idx").on(table.collection),
    index("rdr_archived_at_idx").on(table.archivedAt),
  ],
);

export const roots = cms.table(
  "roots",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("root")),
    collection: text("collection").notNull(),
    parentRootId: text("parent_root_id"),
    slug: text("slug"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    archivedAt: timestamp("archived_at"),
    lastPrunedAt: timestamp("last_pruned_at"),
  },
  (table) => [
    foreignKey({
      columns: [table.parentRootId],
      foreignColumns: [table.id],
      name: "roots_parent_fk",
    }).onDelete("cascade"),
    index("roots_collection_idx").on(table.collection),
    index("roots_parent_root_idx").on(table.parentRootId),
    index("roots_slug_idx").on(table.collection, table.parentRootId, table.slug),
    index("roots_archived_at_idx").on(table.archivedAt),
    index("roots_last_pruned_at_idx").on(table.lastPrunedAt),
  ],
);

export const searchIndex = cms.table(
  "search_index",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("si")),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    collection: text("collection"),
    rootId: text("root_id"),
    contentVector: tsvectorColumn("content_vector").notNull(),
    title: text("title"),
    snippet: text("snippet"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("si_vector_gin").using("gin", table.contentVector),
    index("si_entity_type_idx").on(table.entityType),
    index("si_collection_idx").on(table.collection),
    index("si_root_idx").on(table.rootId),
    uniqueIndex("si_entity_unique").on(table.entityType, table.entityId),
  ],
);

export const templates = cms.table(
  "templates",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("template")),
    collection: text("collection").notNull(),
    blockType: text("block_type").notNull(),
    propertyKey: text("property_key").notNull(),
    template: text("template").notNull(),
    description: text("description"),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("templates_collection_block_prop_idx").on(table.collection, table.blockType, table.propertyKey),
    index("templates_collection_idx").on(table.collection),
    index("templates_collection_block_idx").on(table.collection, table.blockType),
  ],
);

export const templateVariableUsages = cms.table(
  "template_variable_usages",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("tplVarUsage")),
    variableKey: text("variable_key").notNull(),
    templateId: text("template_id").notNull().references(() => templates.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("tvu_key_template_unique").on(table.variableKey, table.templateId),
    index("tvu_variable_key_idx").on(table.variableKey),
    index("tvu_template_id_idx").on(table.templateId),
  ],
);

export const variables = cms.table(
  "variables",
  {
    id: text("id").primaryKey().$defaultFn(() => newId("variable")),
    key: text("key").notNull(),
    value: text("value").notNull(),
    description: text("description"),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("variables_key_idx").on(table.key),
  ],
);

export const schema = {
  approvals,
  assetFolders,
  assets,
  blockVersions,
  branches,
  commentMentions,
  commentMessages,
  commentThreads,
  commits,
  commitSnapshots,
  contentUsages,
  mergeConflicts,
  mergeRequests,
  notifications,
  publications,
  redirects,
  roots,
  searchIndex,
  templates,
  templateVariableUsages,
  variables,
  approvalStatusEnum,
  assetStatusEnum,
  commentMessageTypeEnum,
  commentSystemTypeEnum,
  commentThreadStatusEnum,
  commentThreadTargetEnum,
  conflictResolutionEnum,
  contentUsageTargetEnum,
  mergeRequestStatusEnum,
  notificationTypeEnum,
  redirectEndpointTypeEnum,
};

export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;

export type AssetFolder = typeof assetFolders.$inferSelect;
export type NewAssetFolder = typeof assetFolders.$inferInsert;

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;

export type BlockVersion = typeof blockVersions.$inferSelect;
export type NewBlockVersion = typeof blockVersions.$inferInsert;

export type Branch = typeof branches.$inferSelect;
export type NewBranch = typeof branches.$inferInsert;

export type CommentMention = typeof commentMentions.$inferSelect;
export type NewCommentMention = typeof commentMentions.$inferInsert;

export type CommentMessage = typeof commentMessages.$inferSelect;
export type NewCommentMessage = typeof commentMessages.$inferInsert;

export type CommentThread = typeof commentThreads.$inferSelect;
export type NewCommentThread = typeof commentThreads.$inferInsert;

export type Commit = typeof commits.$inferSelect;
export type NewCommit = typeof commits.$inferInsert;

export type CommitSnapshot = typeof commitSnapshots.$inferSelect;
export type NewCommitSnapshot = typeof commitSnapshots.$inferInsert;

export type ContentUsage = typeof contentUsages.$inferSelect;
export type NewContentUsage = typeof contentUsages.$inferInsert;

export type MergeConflict = typeof mergeConflicts.$inferSelect;
export type NewMergeConflict = typeof mergeConflicts.$inferInsert;

export type MergeRequest = typeof mergeRequests.$inferSelect;
export type NewMergeRequest = typeof mergeRequests.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type Publication = typeof publications.$inferSelect;
export type NewPublication = typeof publications.$inferInsert;

export type Redirect = typeof redirects.$inferSelect;
export type NewRedirect = typeof redirects.$inferInsert;

export type Root = typeof roots.$inferSelect;
export type NewRoot = typeof roots.$inferInsert;

export type SearchIndex = typeof searchIndex.$inferSelect;
export type NewSearchIndex = typeof searchIndex.$inferInsert;

export type Template = typeof templates.$inferSelect;
export type NewTemplate = typeof templates.$inferInsert;

export type TemplateVariableUsage = typeof templateVariableUsages.$inferSelect;
export type NewTemplateVariableUsage = typeof templateVariableUsages.$inferInsert;

export type Variable = typeof variables.$inferSelect;
export type NewVariable = typeof variables.$inferInsert;

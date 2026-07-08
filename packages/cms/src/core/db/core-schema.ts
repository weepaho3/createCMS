import { NOTIFICATION_TYPES } from '../notifications/constants';
import { defineCoreSchema } from './define';

export const coreSchema = defineCoreSchema({
  enums: {
    approvalStatus: {
      enumName: 'approval_status',
      values: ['pending', 'approved', 'rejected'],
    },
    assetStatus: {
      enumName: 'asset_status',
      values: ['private', 'public'],
    },
    mergeRequestStatus: {
      enumName: 'merge_request_status',
      values: ['open', 'merged', 'closed'],
    },
    conflictResolution: {
      enumName: 'conflict_resolution',
      values: ['source', 'target', 'manual'],
    },
    commentThreadTarget: {
      enumName: 'comment_thread_target',
      values: ['mergeRequest', 'block'],
    },
    commentThreadStatus: {
      enumName: 'comment_thread_status',
      values: ['open', 'resolved'],
    },
    commentMessageType: {
      enumName: 'comment_message_type',
      values: ['comment', 'system'],
    },
    commentSystemType: {
      enumName: 'comment_system_type',
      values: ['threadResolved', 'threadReopened'],
    },
    notificationType: {
      enumName: 'notification_type',
      // Single source of truth shared with the browser-safe Zod wire schema.
      values: [...NOTIFICATION_TYPES],
    },
    // A redirect endpoint (source or target) is either a page REFERENCE (rootId,
    // resolves to the page's current path — follows moves) or a literal PATH.
    // 'regex' is reserved for a later version (unindexed ordered scan).
    redirectEndpointType: {
      enumName: 'redirect_endpoint_type',
      values: ['page', 'path'],
    },
    // The kind of content a `content_usages` row indexes. One generalist index
    // (version-keyed, insert-only, branch-head liveness) backs all three: assets
    // (GC reclaim + media-library UI), variables (in-use guard + revalidation),
    // and reusable-block references (delete guard + usage UI). 'reference' is
    // populated from RB1 on; the enum carries it now so RB1 needs no enum change.
    contentUsageTarget: {
      enumName: 'content_usage_target',
      // 'link' is the language-aware link property's INTERNAL target (a rootId),
      // tracked for the usage UI / soft delete-warning (links never hard-block).
      values: ['asset', 'variable', 'reference', 'link'],
    },
  },

  tables: {
    // ========================================================================
    // ROOTS
    // ========================================================================
    roots: {
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'root',
        },
        collection: { type: 'text', notNull: true },
        parentRootId: { type: 'text' },
        slug: { type: 'text' },
        sortOrder: {
          type: 'integer',
          notNull: true,
          default: { kind: 'literal', value: 0 },
        },
        createdBy: { type: 'text' },
        createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
        archivedAt: { type: 'timestamp' },
        lastPrunedAt: { type: 'timestamp' },
      },
      foreignKeys: [
        {
          columns: ['parentRootId'],
          foreignTable: 'roots',
          foreignColumns: ['id'],
          name: 'roots_parent_fk',
          onDelete: 'cascade',
        },
      ],
      indexes: {
        collectionIdx: { columns: ['collection'] },
        parentRootIdx: { columns: ['parentRootId'] },
        // Lookup index for resolvePathToRootId's slug-chain CTE. NON-unique on
        // purpose: a core GLOBAL unique on (collection, parentRootId, slug) cannot
        // be loosened by a plugin (merge.ts only ADDS), so it would forbid the
        // i18n plugin from allowing the SAME slug across languages (en/blog +
        // de/blog). Uniqueness is the app-level authority (validateSlugUniqueness,
        // called on every slug write) plus, under a scoping plugin, a per-scope
        // partial unique. See I18N_DESIGN.md §3 (the redirects "Option B" move).
        slugIdx: {
          columns: ['collection', 'parentRootId', 'slug'],
        },
        // Pruning GC round-robin: pick the least-recently-pruned live roots.
        archivedAtIdx: { columns: ['archivedAt'] },
        lastPrunedAtIdx: { columns: ['lastPrunedAt'] },
      },
    },

    // ========================================================================
    // COMMITS
    // ========================================================================
    commits: {
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'commit',
        },
        rootId: {
          type: 'text',
          notNull: true,
          references: { table: 'roots', column: 'id' },
        },
        parentCommitId: { type: 'text' },
        mergeSourceCommitId: { type: 'text' },
        message: { type: 'text' },
        createdBy: { type: 'text' },
        createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
        // Branch this commit was CREATED on — the source of truth for history
        // attribution. `branchId` links to the live branch (follows renames); no
        // FK, to avoid the circular dependency with branches.headCommitId — a
        // dangling id after a hard branch-delete simply falls back to the name
        // snapshot. `originBranchName` is the deletion-proof name snapshot.
        branchId: { type: 'text' },
        originBranchName: { type: 'text', notNull: true },
      },
      foreignKeys: [
        {
          columns: ['parentCommitId'],
          foreignTable: 'commits',
          foreignColumns: ['id'],
          name: 'commits_parent_fk',
        },
        {
          columns: ['mergeSourceCommitId'],
          foreignTable: 'commits',
          foreignColumns: ['id'],
          name: 'commits_merge_source_fk',
        },
      ],
      indexes: {
        parentIdx: { columns: ['parentCommitId'] },
        mergeSourceIdx: { columns: ['mergeSourceCommitId'] },
        rootCreatedIdx: { columns: ['rootId', 'createdAt'] },
        branchIdx: { columns: ['branchId'] },
      },
    },

    // ========================================================================
    // BRANCHES
    // ========================================================================
    branches: {
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'branch',
        },
        rootId: {
          type: 'text',
          notNull: true,
          references: { table: 'roots', column: 'id' },
        },
        name: { type: 'text', notNull: true },
        headCommitId: {
          type: 'text',
          notNull: true,
          references: { table: 'commits', column: 'id' },
        },
        createdBy: { type: 'text' },
        createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
        updatedAt: { type: 'timestamp', notNull: true, defaultNow: true },
      },
      indexes: {
        rootIdIdx: { columns: ['rootId'] },
        rootNameUnique: { columns: ['rootId', 'name'], unique: true },
      },
    },

    // ========================================================================
    // BLOCK_VERSIONS
    // ========================================================================
    blockVersions: {
      tableName: 'block_versions',
      indexPrefix: 'bv',
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'blockVersion',
        },
        blockId: { type: 'text', notNull: true },
        rootId: {
          type: 'text',
          notNull: true,
          references: { table: 'roots', column: 'id' },
        },
        commitId: {
          type: 'text',
          notNull: true,
          references: { table: 'commits', column: 'id' },
        },
        type: { type: 'text', notNull: true },
        properties: {
          type: 'jsonb',
          notNull: true,
          jsonType: 'Record<string, unknown>',
        },
        children: {
          type: 'jsonb',
          notNull: true,
          jsonType: 'string[]',
          default: { kind: 'literal', value: [] },
        },
        deleted: {
          type: 'boolean',
          notNull: true,
          default: { kind: 'literal', value: false },
        },
        createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
      },
      indexes: {
        blockIdIdx: { columns: ['blockId'] },
        commitIdIdx: { columns: ['commitId'] },
        rootIdIdx: { columns: ['rootId'] },
        blockCommitUnique: {
          columns: ['blockId', 'commitId'],
          unique: true,
        },
        propertiesGin: { columns: ['properties'], using: 'gin' },
      },
    },

    // ========================================================================
    // COMMIT_SNAPSHOTS
    // ========================================================================
    commitSnapshots: {
      tableName: 'commit_snapshots',
      indexPrefix: 'cs',
      columns: {
        commitId: {
          type: 'text',
          notNull: true,
          references: {
            table: 'commits',
            column: 'id',
            onDelete: 'cascade',
          },
        },
        blockId: { type: 'text', notNull: true },
        blockVersionId: {
          type: 'text',
          notNull: true,
          references: {
            table: 'blockVersions',
            column: 'id',
            onDelete: 'cascade',
          },
        },
      },
      compositePrimaryKey: { columns: ['commitId', 'blockId'] },
      indexes: {
        blockVersionIdx: { columns: ['blockVersionId'] },
      },
    },

    // ========================================================================
    // PUBLICATIONS
    // ========================================================================
    publications: {
      columns: {
        rootId: {
          type: 'text',
          notNull: true,
          references: { table: 'roots', column: 'id' },
        },
        branchId: {
          type: 'text',
          notNull: true,
          references: { table: 'branches', column: 'id' },
        },
        commitId: {
          type: 'text',
          notNull: true,
          references: { table: 'commits', column: 'id' },
        },
        publishedBy: { type: 'text', notNull: true },
        publishedAt: { type: 'timestamp', notNull: true, defaultNow: true },
      },
      compositePrimaryKey: { columns: ['rootId', 'branchId'] },
      indexes: {
        branchIdx: { columns: ['branchId'] },
      },
    },

    // ========================================================================
    // MERGE_REQUESTS
    // ========================================================================
    mergeRequests: {
      tableName: 'merge_requests',
      indexPrefix: 'mr',
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'mergeRequest',
        },
        rootId: {
          type: 'text',
          notNull: true,
          references: { table: 'roots', column: 'id' },
        },
        sourceBranchId: {
          type: 'text',
          notNull: true,
          references: { table: 'branches', column: 'id' },
        },
        targetBranchId: {
          type: 'text',
          notNull: true,
          references: { table: 'branches', column: 'id' },
        },
        sourceCommitId: {
          type: 'text',
          notNull: true,
          references: { table: 'commits', column: 'id' },
        },
        baseCommitId: {
          type: 'text',
          references: { table: 'commits', column: 'id' },
        },
        mergeCommitId: {
          type: 'text',
          references: { table: 'commits', column: 'id' },
        },
        status: {
          type: { enum: 'mergeRequestStatus' },
          notNull: true,
          default: { kind: 'literal', value: 'open' },
        },
        title: { type: 'text' },
        description: { type: 'text' },
        createdBy: { type: 'text', notNull: true },
        createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
        updatedAt: { type: 'timestamp', notNull: true, defaultNow: true },
      },
      indexes: {
        rootIdx: { columns: ['rootId'] },
        sourceBranchIdx: { columns: ['sourceBranchId'] },
        targetBranchIdx: { columns: ['targetBranchId'] },
        statusIdx: { columns: ['status'] },
        openSourceTargetUnique: {
          columns: ['sourceBranchId', 'targetBranchId'],
          unique: true,
          where: "status = 'open'",
        },
      },
    },

    // ========================================================================
    // MERGE_CONFLICTS
    // ========================================================================
    mergeConflicts: {
      tableName: 'merge_conflicts',
      indexPrefix: 'mc',
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'mergeConflict',
        },
        mergeRequestId: {
          type: 'text',
          notNull: true,
          references: {
            table: 'mergeRequests',
            column: 'id',
            onDelete: 'cascade',
          },
        },
        blockId: { type: 'text', notNull: true },
        sourceVersionId: {
          type: 'text',
          references: { table: 'blockVersions', column: 'id' },
        },
        targetVersionId: {
          type: 'text',
          references: { table: 'blockVersions', column: 'id' },
        },
        baseVersionId: {
          type: 'text',
          references: { table: 'blockVersions', column: 'id' },
        },
        resolution: { type: { enum: 'conflictResolution' } },
        resolvedVersionId: {
          type: 'text',
          references: { table: 'blockVersions', column: 'id' },
        },
        resolvedBy: { type: 'text' },
        resolvedAt: { type: 'timestamp' },
        createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
      },
      indexes: {
        mergeRequestIdx: { columns: ['mergeRequestId'] },
        mergeBlockUnique: {
          columns: ['mergeRequestId', 'blockId'],
          unique: true,
        },
      },
    },

    // ========================================================================
    // APPROVALS
    // ========================================================================
    approvals: {
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'approval',
        },
        mergeRequestId: {
          type: 'text',
          references: {
            table: 'mergeRequests',
            column: 'id',
            onDelete: 'cascade',
          },
        },
        branchId: {
          type: 'text',
          notNull: true,
          references: { table: 'branches', column: 'id' },
        },
        commitId: {
          type: 'text',
          notNull: true,
          references: { table: 'commits', column: 'id' },
        },
        status: {
          type: { enum: 'approvalStatus' },
          notNull: true,
          default: { kind: 'literal', value: 'pending' },
        },
        requestedBy: { type: 'text', notNull: true },
        requestedReviewer: { type: 'text', notNull: true },
        reviewedBy: { type: 'text' },
        message: { type: 'text' },
        rejectionReason: { type: 'text' },
        reviewedAt: { type: 'timestamp' },
        createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
        updatedAt: { type: 'timestamp', notNull: true, defaultNow: true },
      },
      indexes: {
        mrIdx: { columns: ['mergeRequestId'] },
        branchIdx: { columns: ['branchId'] },
        branchCommitIdx: { columns: ['branchId', 'commitId'] },
        statusIdx: { columns: ['status'] },
        requestedReviewerIdx: { columns: ['requestedReviewer'] },
        targetReviewerUnique: {
          columns: [
            'mergeRequestId',
            'branchId',
            'commitId',
            'requestedReviewer',
          ],
          unique: true,
        },
      },
    },

    // ========================================================================
    // ASSET_FOLDERS
    // ========================================================================
    assetFolders: {
      tableName: 'asset_folders',
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'assetFolder',
        },
        name: { type: 'text', notNull: true },
        parentId: { type: 'text' },
        createdBy: { type: 'text' },
        createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
      },
      foreignKeys: [
        {
          columns: ['parentId'],
          foreignTable: 'assetFolders',
          foreignColumns: ['id'],
          name: 'asset_folders_parent_fk',
          onDelete: 'cascade',
        },
      ],
      indexes: {
        parentIdx: { columns: ['parentId'] },
        nameUnique: {
          columns: ['parentId', 'name'],
          unique: true,
        },
      },
    },

    // ========================================================================
    // ASSETS
    // ========================================================================
    assets: {
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'asset',
        },
        slug: { type: 'text', notNull: true },
        mimeType: { type: 'text', notNull: true },
        size: { type: 'integer', notNull: true },
        objectKey: { type: 'text', notNull: true },
        status: {
          type: { enum: 'assetStatus' },
          notNull: true,
          default: { kind: 'literal', value: 'private' },
        },
        folderId: {
          type: 'text',
          references: {
            table: 'assetFolders',
            column: 'id',
            onDelete: 'set null',
          },
        },
        variantOf: {
          type: 'text',
          references: {
            table: 'assets',
            column: 'id',
            onDelete: 'set null',
          },
        },
        uploadedBy: { type: 'text' },
        createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
        updatedAt: { type: 'timestamp', notNull: true, defaultNow: true },
        archivedAt: { type: 'timestamp' },
      },
      indexes: {
        folderIdx: { columns: ['folderId'] },
        statusIdx: { columns: ['status'] },
        variantOfIdx: { columns: ['variantOf'] },
        objectKeyUnique: { columns: ['objectKey'], unique: true },
        slugUnique: { columns: ['slug'], unique: true },
      },
    },

    // ========================================================================
    // COMMENT_THREADS
    // ========================================================================
    commentThreads: {
      tableName: 'comment_threads',
      indexPrefix: 'ct',
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'commentThread',
        },
        rootId: {
          type: 'text',
          references: { table: 'roots', column: 'id', onDelete: 'cascade' },
        },
        collection: { type: 'text', notNull: true },
        targetType: {
          type: { enum: 'commentThreadTarget' },
          notNull: true,
        },
        mergeRequestId: {
          type: 'text',
          references: {
            table: 'mergeRequests',
            column: 'id',
            onDelete: 'cascade',
          },
        },
        blockId: { type: 'text' },
        commitId: {
          type: 'text',
          references: {
            table: 'commits',
            column: 'id',
            onDelete: 'set null',
          },
        },
        status: {
          type: { enum: 'commentThreadStatus' },
          notNull: true,
          default: { kind: 'literal', value: 'open' },
        },
        resolvedBy: { type: 'text' },
        resolvedAt: { type: 'timestamp' },
        createdBy: { type: 'text', notNull: true },
        createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
        updatedAt: { type: 'timestamp', notNull: true, defaultNow: true },
        deletedAt: { type: 'timestamp' },
      },
      indexes: {
        collectionIdx: { columns: ['collection', 'createdAt'] },
        mrIdx: { columns: ['mergeRequestId', 'createdAt'] },
        blockIdx: { columns: ['blockId', 'createdAt'] },
        commitIdx: { columns: ['commitId', 'createdAt'] },
        rootIdx: { columns: ['rootId', 'createdAt'] },
        statusIdx: { columns: ['status'] },
      },
    },

    // ========================================================================
    // COMMENT_MESSAGES
    // ========================================================================
    commentMessages: {
      tableName: 'comment_messages',
      indexPrefix: 'cm',
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'commentMessage',
        },
        threadId: {
          type: 'text',
          notNull: true,
          references: {
            table: 'commentThreads',
            column: 'id',
            onDelete: 'cascade',
          },
        },
        parentMessageId: { type: 'text' },
        authorId: { type: 'text' },
        messageType: {
          type: { enum: 'commentMessageType' },
          notNull: true,
          default: { kind: 'literal', value: 'comment' },
        },
        systemType: { type: { enum: 'commentSystemType' } },
        body: { type: 'text' },
        meta: { type: 'jsonb', jsonType: 'Record<string, unknown>' },
        editedAt: { type: 'timestamp' },
        deletedAt: { type: 'timestamp' },
        createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
        updatedAt: { type: 'timestamp', notNull: true, defaultNow: true },
      },
      foreignKeys: [
        {
          columns: ['parentMessageId'],
          foreignTable: 'commentMessages',
          foreignColumns: ['id'],
          name: 'comment_messages_parent_fk',
          onDelete: 'set null',
        },
      ],
      indexes: {
        threadIdx: { columns: ['threadId', 'createdAt'] },
        parentIdx: { columns: ['parentMessageId'] },
        typeIdx: { columns: ['messageType', 'systemType'] },
        authorIdx: { columns: ['authorId', 'createdAt'] },
      },
    },

    // ========================================================================
    // COMMENT_MENTIONS
    // ========================================================================
    commentMentions: {
      tableName: 'comment_mentions',
      indexPrefix: 'cmn',
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'commentMention',
        },
        messageId: {
          type: 'text',
          notNull: true,
          references: {
            table: 'commentMessages',
            column: 'id',
            onDelete: 'cascade',
          },
        },
        threadId: {
          type: 'text',
          notNull: true,
          references: {
            table: 'commentThreads',
            column: 'id',
            onDelete: 'cascade',
          },
        },
        mentionedUserId: { type: 'text', notNull: true },
        mentionedBy: { type: 'text', notNull: true },
        createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
      },
      indexes: {
        userIdx: { columns: ['mentionedUserId', 'createdAt'] },
        messageIdx: { columns: ['messageId'] },
        threadUserIdx: { columns: ['threadId', 'mentionedUserId'] },
        messageUserUnique: {
          columns: ['messageId', 'mentionedUserId'],
          unique: true,
        },
      },
    },

    // ========================================================================
    // ASSET_REFERENCES
    // ========================================================================
    // ========================================================================
    // CONTENT_USAGES — One generalist materialized index for ALL content-derived
    // usage: assets, variables, and reusable-block references. Replaces the old
    // per-domain asset_references + variable_usages tables (structurally one
    // pattern). Keyed by the IMMUTABLE blockVersionId: a block diverges per
    // branch into distinct, append-only versions, so a version-keyed row never
    // drifts. Rows are inserted ONCE when a version is created (never re-synced)
    // and removed only by FK cascade when the version (or its root) is pruned.
    // LIVENESS is decided by joining to branch-HEAD snapshots, never a stored
    // flag — a superseded version simply stops counting. `targetKey` is
    // POLYMORPHIC (assetId | variableKey | referencedRootId) and intentionally
    // carries NO FK: correctness comes from the liveness join, not a per-target
    // cascade (verified — asset GC reclaim + hardDeleteRoot depend on the
    // blockVersionId/rootId keys + the join). This is the single source of truth
    // for the destructive GC/guards AND the usage UIs.
    contentUsages: {
      tableName: 'content_usages',
      indexPrefix: 'cu',
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'contentUsage',
        },
        targetKind: { type: { enum: 'contentUsageTarget' }, notNull: true },
        // assetId | variableKey | referencedRootId — discriminated by targetKind.
        targetKey: { type: 'text', notNull: true },
        blockVersionId: {
          type: 'text',
          notNull: true,
          references: {
            table: 'blockVersions',
            column: 'id',
            onDelete: 'cascade',
          },
        },
        // rootId/blockId are the denormalized HOST root/block for fast UI
        // grouping and for the prune-by-rootId path; rootId also cascades.
        rootId: {
          type: 'text',
          notNull: true,
          references: { table: 'roots', column: 'id', onDelete: 'cascade' },
        },
        blockId: { type: 'text', notNull: true },
        propertyKey: { type: 'text', notNull: true },
      },
      indexes: {
        versionTargetPropUnique: {
          columns: ['blockVersionId', 'targetKind', 'targetKey', 'propertyKey'],
          unique: true,
        },
        targetIdx: { columns: ['targetKind', 'targetKey'] },
        blockVersionIdx: { columns: ['blockVersionId'] },
        rootIdx: { columns: ['rootId'] },
      },
    },

    // ========================================================================
    // VARIABLES — User-editable key-value pairs for content substitution
    // ========================================================================
    variables: {
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'variable',
        },
        key: { type: 'text', notNull: true },
        value: { type: 'text', notNull: true },
        description: { type: 'text' },
        createdBy: { type: 'text' },
        updatedBy: { type: 'text' },
        createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
        updatedAt: { type: 'timestamp', notNull: true, defaultNow: true },
      },
      indexes: {
        // Non-unique lookup. A core GLOBAL unique on `key` cannot be loosened by
        // a plugin and would forbid the same variable per tenant/language, so
        // uniqueness is the app-level authority (createVariable's scope-aware
        // existence check). The compound key (tenant_slug, language, key) can't
        // be expressed by either scoping plugin alone — same as templates.
        keyIdx: { columns: ['key'] },
      },
    },

    // ========================================================================
    // TEMPLATES — Default-value formulas per collection/block/property
    // ========================================================================
    templates: {
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'template',
        },
        collection: { type: 'text', notNull: true },
        blockType: { type: 'text', notNull: true },
        propertyKey: { type: 'text', notNull: true },
        template: { type: 'text', notNull: true },
        description: { type: 'text' },
        createdBy: { type: 'text' },
        updatedBy: { type: 'text' },
        createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
        updatedAt: { type: 'timestamp', notNull: true, defaultNow: true },
      },
      indexes: {
        // Non-unique lookup. A core GLOBAL unique on (collection, blockType,
        // propertyKey) cannot be loosened by a plugin and would forbid the same
        // template across tenants/languages, so uniqueness is the app-level
        // authority (createTemplate's scope-aware existence check). The correct
        // compound key (tenant_slug, language, collection, blockType, propertyKey)
        // can't be expressed by either scoping plugin alone — same situation as
        // redirects' path-source.
        collectionBlockPropIdx: {
          columns: ['collection', 'blockType', 'propertyKey'],
        },
        collectionIdx: { columns: ['collection'] },
        collectionBlockIdx: { columns: ['collection', 'blockType'] },
      },
    },

    // ========================================================================
    // TEMPLATE_VARIABLE_USAGES — Tracks which variables are used in templates
    // ========================================================================
    templateVariableUsages: {
      tableName: 'template_variable_usages',
      indexPrefix: 'tvu',
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'tplVarUsage',
        },
        variableKey: { type: 'text', notNull: true },
        templateId: {
          type: 'text',
          notNull: true,
          references: {
            table: 'templates',
            column: 'id',
            onDelete: 'cascade',
          },
        },
      },
      indexes: {
        keyTemplateUnique: {
          columns: ['variableKey', 'templateId'],
          unique: true,
        },
        variableKeyIdx: { columns: ['variableKey'] },
        templateIdIdx: { columns: ['templateId'] },
      },
    },

    // ========================================================================
    // SEARCH_INDEX — Materialized full-text search index across all entities
    // ========================================================================
    searchIndex: {
      tableName: 'search_index',
      indexPrefix: 'si',
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'si',
        },
        entityType: { type: 'text', notNull: true },
        entityId: { type: 'text', notNull: true },
        collection: { type: 'text' },
        rootId: { type: 'text' },
        contentVector: { type: 'tsvector', notNull: true },
        title: { type: 'text' },
        snippet: { type: 'text' },
        meta: { type: 'jsonb', jsonType: 'Record<string, unknown>' },
        updatedAt: { type: 'timestamp', notNull: true, defaultNow: true },
      },
      indexes: {
        vectorGin: { columns: ['contentVector'], using: 'gin' },
        entityTypeIdx: { columns: ['entityType'] },
        collectionIdx: { columns: ['collection'] },
        rootIdx: { columns: ['rootId'] },
        entityUnique: {
          columns: ['entityType', 'entityId'],
          unique: true,
        },
      },
    },

    // ========================================================================
    // NOTIFICATIONS — In-app notification inbox per user
    // ========================================================================
    notifications: {
      tableName: 'notifications',
      indexPrefix: 'ntf',
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'notification',
        },
        recipientId: { type: 'text', notNull: true },
        actorId: { type: 'text' },
        type: {
          type: { enum: 'notificationType' },
          notNull: true,
        },
        title: { type: 'text', notNull: true },
        body: { type: 'text' },
        resourceType: { type: 'text' },
        resourceId: { type: 'text' },
        collection: { type: 'text' },
        meta: { type: 'jsonb', jsonType: 'Record<string, unknown>' },
        readAt: { type: 'timestamp' },
        archivedAt: { type: 'timestamp' },
        createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
      },
      indexes: {
        recipientCreatedIdx: { columns: ['recipientId', 'createdAt'] },
        recipientUnreadIdx: { columns: ['recipientId', 'readAt'] },
        resourceIdx: { columns: ['resourceType', 'resourceId'] },
        typeIdx: { columns: ['type'] },
      },
    },

    // ========================================================================
    // REDIRECTS — SEO 301/302 mapping (see REDIRECTS_DESIGN.md)
    // ========================================================================
    // Source and target are each a page REFERENCE (rootId → current path,
    // follows moves) or a literal PATH. Auto-created on rename/move/archive,
    // or managed manually. Resolved by the consumer before serving content.
    redirects: {
      tableName: 'redirects',
      indexPrefix: 'rdr',
      columns: {
        id: {
          type: 'text',
          primaryKey: true,
          defaultId: true,
          defaultIdPrefix: 'redirect',
        },
        collection: { type: 'text', notNull: true },
        sourceType: { type: { enum: 'redirectEndpointType' }, notNull: true },
        // 'page' source: redirect away from this live page (follows its slug).
        sourceRootId: {
          type: 'text',
          references: { table: 'roots', column: 'id', onDelete: 'cascade' },
        },
        // 'path' source: the exact (normalized) old/dead path.
        sourcePath: { type: 'text' },
        targetType: { type: { enum: 'redirectEndpointType' }, notNull: true },
        // 'page' target: resolves to the root's CURRENT published path.
        targetRootId: {
          type: 'text',
          references: { table: 'roots', column: 'id', onDelete: 'cascade' },
        },
        // 'path' target: literal / external destination.
        targetPath: { type: 'text' },
        statusCode: {
          type: 'integer',
          notNull: true,
          default: { kind: 'literal', value: 301 },
        },
        createdBy: { type: 'text' },
        createdAt: { type: 'timestamp', notNull: true, defaultNow: true },
        updatedAt: { type: 'timestamp', notNull: true, defaultNow: true },
        archivedAt: { type: 'timestamp' },
      },
      indexes: {
        // Exact path-source lookup (collection + path). NON-unique on purpose:
        // uniqueness of a source is enforced at the APPLICATION level
        // (assertSourceUnique + the auto-create pre-check), scope-filtered where a
        // scoping plugin is active. A core DB-unique on (collection, sourcePath)
        // would be GLOBAL — it cannot be loosened by a plugin (merge.ts only ADDS
        // indexes), so two scopes could never share a path. A scoping
        // plugin instead adds its own PARTIAL UNIQUE on its scope column(s) + (collection,
        // sourcePath), which is the real DB guarantee when scoping is on.
        collectionSourcePathIdx: {
          columns: ['collection', 'sourcePath'],
        },
        // Page-source lookup: does this live root redirect away? NON-unique for
        // the same reason (per-scope uniqueness is the plugin's job).
        sourceRootIdx: {
          columns: ['sourceRootId'],
        },
        collectionIdx: { columns: ['collection'] },
        archivedAtIdx: { columns: ['archivedAt'] },
      },
    },
  },
});

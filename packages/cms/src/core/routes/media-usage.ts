import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import * as z from 'zod';

import type { ChangedVersion } from '../blocks/commit-writer';
import type { UsageScope } from '../media/usage';
import type { CMSProcedureContext, MediaConfig } from '../types';

import { writeCommit } from '../blocks/commit-writer';
import { lockWritableBranch } from '../blocks/guards';
import { loadBlocksAtCommit } from '../blocks/reconstruct-snapshot';
import { resolveBranchPolicy } from '../branch-policy';
import { propertySpecsFor } from '../content-index';
import {
  assets,
  publications,
  scheduledPublications,
  searchIndex,
} from '../db/schema.generated';
import { cmsMeta, createCMSEndpoint } from '../endpoint';
import { CMSError, errorMessages } from '../errors';
import { assetsUsedExternally } from '../media/archive';
import { rewriteUsages } from '../media/extract-usages';
import { assetUsageCounts, scopedUsages } from '../media/usage';
import { crossScopeColumns } from '../scope';

const MEDIA_META = {
  scope: 'system' as const,
  permissionResource: 'media' as const,
};

/** Reusable blocks are followed this many levels up to the pages that embed them. */
const MAX_REFERENCE_DEPTH = 20;

export type UsageOccurrence = {
  branchId: string | null;
  branchName: string | null;
  blockId: string;
  propertyKey: string;
  /** JSON pointer inside the block's properties. */
  path: string;
  matchedBy: string;
  altState: string | null;
  revisionId: string | null;
};

export type UsageItem = {
  rootId: string;
  collection: string;
  title: string;
  storedSlug: string | null;
  status: 'published' | 'scheduled' | 'draft';
  /** The reusable block the asset sits in, when this root embeds it. */
  via: { rootId: string; title: string } | null;
  occurrences: UsageOccurrence[];
};

const scopeSchema = z.enum(['live', 'published', 'history']);

/** Rewriting content across collections needs more than the media resource. */
const REPLACE_META = {
  scope: 'system' as const,
  permissionResource: 'admin' as const,
};

function aspectDiffers(
  a: { width: number | null; height: number | null },
  b: { width: number | null; height: number | null },
): boolean {
  if (!a.width || !a.height || !b.width || !b.height) return true;
  return Math.abs(a.width / a.height - b.width / b.height) > 0.01;
}

function errorCode(err: unknown): string {
  if (err instanceof CMSError) return err.cmsCode ?? 'UNKNOWN';
  const body = (err as { body?: { code?: unknown } }).body;
  return typeof body?.code === 'string' ? body.code : 'UNKNOWN';
}

function encodeCursor(collection: string, rootId: string): string {
  return Buffer.from(JSON.stringify([collection, rootId])).toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): [string, string] | null {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    return Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'string'
      ? [value[0], value[1]]
      : null;
  } catch {
    return null;
  }
}

export type ExternalUsageItem = {
  consumer: string;
  /** `null` for a `usageSources` entry, which names no place. */
  url: string | null;
  registeredAt: string | null;
  /** `true` for a `usageSources` entry, which keeps the asset from being archived. */
  blocking: boolean;
};

/** A registered usage URL: http(s), without credentials. */
const externalUrl = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'https:' || url.protocol === 'http:') &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, 'An http(s) URL without credentials');

export function createMediaUsageEndpoints(
  cmsCtx: CMSProcedureContext,
  mediaConfig?: MediaConfig,
) {
  const { db } = cmsCtx;

  /** Registered usages and usage sources of `assetId`, sources first. */
  async function externalUsagesOf(
    assetId: string,
  ): Promise<ExternalUsageItem[]> {
    const items: ExternalUsageItem[] = [];
    for (const source of mediaConfig?.usageSources ?? []) {
      const used = await assetsUsedExternally(
        { ...mediaConfig!, usageSources: [source] },
        [assetId],
      );
      if (used.has(assetId)) {
        items.push({
          consumer: source.kind,
          url: null,
          registeredAt: null,
          blocking: true,
        });
      }
    }
    for (const usage of (await mediaConfig?.externalUsage?.list([assetId])) ??
      []) {
      items.push({
        consumer: usage.consumer,
        url: usage.url,
        registeredAt: usage.registeredAt.toISOString(),
        blocking: false,
      });
    }
    return items;
  }

  function registry() {
    const registry = mediaConfig?.externalUsage;
    if (!registry) throw new CMSError('EXTERNAL_USAGE_NOT_CONFIGURED');
    return registry;
  }

  async function assertAssetsInScope(
    assetIds: string[],
    assetsWhere: SQL | undefined,
  ): Promise<string[]> {
    const conditions: SQL[] = [inArray(assets.id, assetIds)];
    if (assetsWhere) conditions.push(assetsWhere);
    const rows = await db
      .select({ id: assets.id })
      .from(assets)
      .where(and(...conditions));
    return rows.map((r) => r.id);
  }

  async function describeRoots(rootIds: string[]) {
    if (rootIds.length === 0) {
      return {
        titles: new Map<string, string>(),
        status: new Map<string, UsageItem['status']>(),
      };
    }
    const [titleRows, published, scheduled] = await Promise.all([
      db
        .select({ rootId: searchIndex.entityId, title: searchIndex.title })
        .from(searchIndex)
        .where(
          and(
            eq(searchIndex.entityType, 'root'),
            inArray(searchIndex.entityId, rootIds),
          ),
        ),
      db
        .selectDistinct({ rootId: publications.rootId })
        .from(publications)
        .where(inArray(publications.rootId, rootIds)),
      db
        .selectDistinct({ rootId: scheduledPublications.rootId })
        .from(scheduledPublications)
        .where(
          and(
            inArray(scheduledPublications.rootId, rootIds),
            eq(scheduledPublications.action, 'publish'),
            isNull(scheduledPublications.processedAt),
          ),
        ),
    ]);
    const titles = new Map(
      titleRows.flatMap((r) => (r.title ? [[r.rootId, r.title] as const] : [])),
    );
    const status = new Map<string, UsageItem['status']>();
    for (const r of scheduled) status.set(r.rootId, 'scheduled');
    for (const r of published) status.set(r.rootId, 'published');
    return { titles, status };
  }

  return {
    /**
     * Where an asset is used, grouped by root and paginated (keyset over collection and root id). Each root lists its occurrences per branch with the block, property, JSON-pointer path, how the usage was found (`schema`, `url`, `heuristic`), the alt-text state and a revision pin. Pages that embed a reusable block using the asset are listed with `via`. Roots outside the caller's scope only count in `total.hiddenRoots`.
     * @param assetId - The asset.
     * @param scope - `live` (default: the head of any branch), `published`, `history` (any commit); with `branchId`, one branch's head.
     * @param branchId - Restricts the live scope to one branch.
     * @param collection - Only roots of this collection.
     * @param missingAlt - Only image usages without alt text.
     * @param cursor - The `nextCursor` of the previous page.
     * @param limit - Roots per page, 1 to 100 (default 20).
     * @returns `{ total: { roots, occurrences, hiddenRoots }, items, nextCursor, external }`; each item is `{ rootId, collection, title, storedSlug, status, via, occurrences }` with `status` `published`, `scheduled` or `draft`. `external` (first page only) lists usages outside content: `usageSources` hits (`blocking: true`, no `url`) and registered external usages (`blocking: false`).
     * @throws ASSET_NOT_FOUND if the asset is not in the caller's scope.
     * @example await cmsClient.media.getAssetUsages({ query: { assetId: 'ast_...', scope: 'published' } })
     */
    getAssetUsages: createCMSEndpoint(
      '/media/getAssetUsages',
      {
        method: 'GET',
        query: z.object({
          assetId: z.string(),
          scope: scopeSchema.optional(),
          branchId: z.string().optional(),
          collection: z.string().optional(),
          missingAlt: z.enum(['true', 'false']).optional(),
          cursor: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(100).optional(),
        }),
        metadata: cmsMeta(
          {
            $Infer: {
              query: {} as {
                assetId: string;
                scope?: 'live' | 'published' | 'history';
                branchId?: string;
                collection?: string;
                missingAlt?: 'true' | 'false';
                cursor?: string;
                limit?: number;
              },
            },
          },
          { operation: 'read', ...MEDIA_META },
        ),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const query = ctx.query;
        const [asset] = await assertAssetsInScope(
          [query.assetId],
          scope.assets?.where,
        );
        if (!asset) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: errorMessages.assetNotFound(query.assetId),
          });
        }
        const usageScope: UsageScope = query.branchId
          ? { branchId: query.branchId }
          : (query.scope ?? 'live');
        const scopeColumns = crossScopeColumns(scope.roots);
        const missingAlt = query.missingAlt === 'true';
        const limit = query.limit ?? 20;

        const direct = await scopedUsages(db, {
          assetIds: [asset],
          scope: usageScope,
          scopeColumns,
          rootsWhere: scope.roots?.where,
          missingAlt,
        });

        // Roots that embed a reusable block using the asset, level by level.
        type Row = (typeof direct)[number] & { via: string | null };
        const rows: Row[] = direct.map((row) => ({ ...row, via: null }));
        const seen = new Set(direct.map((row) => row.rootId));
        // A missing-alt query lists the image usages themselves only.
        let frontier = new Map(
          missingAlt ? [] : direct.map((row) => [row.rootId, row.rootId]),
        );
        for (
          let depth = 0;
          depth < MAX_REFERENCE_DEPTH && frontier.size > 0;
          depth++
        ) {
          const embedding = await scopedUsages(db, {
            kind: 'reference',
            assetIds: [...frontier.keys()],
            scope: usageScope,
            scopeColumns,
            rootsWhere: scope.roots?.where,
          });
          const next = new Map<string, string>();
          for (const row of embedding) {
            if (seen.has(row.rootId)) continue;
            const via = frontier.get(row.assetId) ?? row.assetId;
            rows.push({ ...row, via });
            next.set(row.rootId, via);
          }
          for (const id of next.keys()) seen.add(id);
          frontier = next;
        }

        const filtered = query.collection
          ? rows.filter((row) => row.collection === query.collection)
          : rows;
        const groups = new Map<string, Row[]>();
        for (const row of filtered) {
          const list = groups.get(row.rootId) ?? [];
          list.push(row);
          groups.set(row.rootId, list);
        }
        const ordered = [...groups.values()].sort(
          (a, b) =>
            a[0].collection.localeCompare(b[0].collection) ||
            a[0].rootId.localeCompare(b[0].rootId),
        );
        const after = query.cursor ? decodeCursor(query.cursor) : null;
        const start = after
          ? ordered.findIndex(
              (g) =>
                g[0].collection > after[0] ||
                (g[0].collection === after[0] && g[0].rootId > after[1]),
            )
          : 0;
        const page = start === -1 ? [] : ordered.slice(start, start + limit);
        const more = start !== -1 && start + limit < ordered.length;

        const rootIds = page.map((g) => g[0].rootId);
        const viaIds = page.flatMap((g) => (g[0].via ? [g[0].via] : []));
        const { titles, status } = await describeRoots([
          ...new Set([...rootIds, ...viaIds]),
        ]);

        // Roots using the asset outside the caller's scope count, unnamed.
        const unscoped = await assetUsageCounts(db, [asset], usageScope);
        const hiddenRoots = Math.max(
          0,
          unscoped[asset].roots -
            direct.reduce((set, row) => set.add(row.rootId), new Set<string>())
              .size,
        );

        const items: UsageItem[] = page.map((group) => {
          const first = group[0];
          return {
            rootId: first.rootId,
            collection: first.collection,
            title: titles.get(first.rootId) ?? first.slug ?? first.rootId,
            storedSlug: first.slug,
            status: status.get(first.rootId) ?? 'draft',
            via: first.via
              ? { rootId: first.via, title: titles.get(first.via) ?? first.via }
              : null,
            occurrences: group.map((row) => ({
              branchId: row.branchId,
              branchName: row.branchName,
              blockId: row.blockId,
              propertyKey: row.propertyKey,
              path: row.path,
              matchedBy: row.matchedBy,
              altState: row.altState,
              revisionId: row.revisionId,
            })),
          };
        });
        const last = page.at(-1)?.[0];
        return {
          total: {
            roots: groups.size,
            occurrences: filtered.length,
            hiddenRoots,
          },
          items,
          nextCursor:
            more && last ? encodeCursor(last.collection, last.rootId) : null,
          external: query.cursor ? [] : await externalUsagesOf(asset),
        };
      },
    ),

    /**
     * Replaces one asset with another everywhere it is used: one commit per root and branch head (`Replace asset <from> with <to>`) through the normal commit pipeline, so the usage index follows. Image values keep their alt text and caption; a revision pin is dropped, and so is a crop when the two assets' aspect ratios differ. Branches the branch policy protects fail with their error and the others go on. Usages found in text (`url`, `heuristic`) are not rewritten; their count is reported. Collection hooks do not run.
     * @param fromAssetId - The asset to replace.
     * @param toAssetId - The asset to use instead (an original, not a variant or revision).
     * @param branchIds - Only these branches; default every branch head that uses the asset.
     * @param dryRun - List the affected root and branch pairs without committing.
     * @returns `{ results: { rootId, branchId, ok, commitId, blocks, error }[], cropDropped, notRewritten }`.
     * @throws ASSET_NOT_FOUND if either asset is not a live asset in scope.
     * @example await cmsClient.media.replaceAssetUsages({ fromAssetId: 'ast_old', toAssetId: 'ast_new', dryRun: true })
     */
    replaceAssetUsages: createCMSEndpoint(
      '/media/replaceAssetUsages',
      {
        method: 'POST',
        body: z.object({
          fromAssetId: z.string(),
          toAssetId: z.string(),
          branchIds: z.array(z.string()).min(1).max(100).optional(),
          dryRun: z.boolean().optional(),
        }),
        metadata: cmsMeta({}, { operation: 'update', ...REPLACE_META }),
      },
      async (ctx) => {
        const { scope, userId } = ctx.context;
        const { fromAssetId, toAssetId, branchIds, dryRun } = ctx.body;
        const conditions: SQL[] = [
          inArray(assets.id, [fromAssetId, toAssetId]),
          isNull(assets.archivedAt),
        ];
        if (scope.assets?.where) conditions.push(scope.assets.where);
        const found = await db
          .select({
            id: assets.id,
            width: assets.width,
            height: assets.height,
            variantOf: assets.variantOf,
            revisionOf: assets.revisionOf,
          })
          .from(assets)
          .where(and(...conditions));
        const from = found.find((a) => a.id === fromAssetId);
        const to = found.find((a) => a.id === toAssetId);
        if (!from || !to || to.variantOf || to.revisionOf || from === to) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: errorMessages.assetNotFound(
              !from ? fromAssetId : toAssetId,
            ),
          });
        }
        const dropCrop = aspectDiffers(from, to);

        const usages = (
          await scopedUsages(db, {
            assetIds: [fromAssetId],
            scope: 'live',
            scopeColumns: crossScopeColumns(scope.roots),
            rootsWhere: scope.roots?.where,
          })
        ).filter(
          (u) => !branchIds || (u.branchId && branchIds.includes(u.branchId)),
        );
        const notRewritten = usages.filter(
          (u) => u.matchedBy !== 'schema',
        ).length;
        const targets = new Map<
          string,
          {
            rootId: string;
            branchId: string;
            collection: string;
            blockIds: Set<string>;
          }
        >();
        for (const usage of usages) {
          if (usage.matchedBy !== 'schema' || !usage.branchId) continue;
          const key = `${usage.rootId}:${usage.branchId}`;
          const target = targets.get(key) ?? {
            rootId: usage.rootId,
            branchId: usage.branchId,
            collection: usage.collection,
            blockIds: new Set<string>(),
          };
          target.blockIds.add(usage.blockId);
          targets.set(key, target);
        }

        const results: {
          rootId: string;
          branchId: string;
          ok: boolean;
          commitId: string | null;
          blocks: number;
          error: string | null;
        }[] = [];
        for (const target of targets.values()) {
          const base = {
            rootId: target.rootId,
            branchId: target.branchId,
            blocks: target.blockIds.size,
          };
          if (dryRun) {
            results.push({ ...base, ok: true, commitId: null, error: null });
            continue;
          }
          const def = cmsCtx.collections[target.collection];
          if (!def) {
            results.push({
              ...base,
              ok: false,
              commitId: null,
              error: 'COLLECTION_NOT_FOUND',
            });
            continue;
          }
          try {
            const commitId = await db.transaction(async (tx) => {
              const branch = await lockWritableBranch(
                tx,
                resolveBranchPolicy(cmsCtx, def.branchProtection),
                target.rootId,
                target.branchId,
              );
              const { blocks } = await loadBlocksAtCommit(
                tx,
                branch.headCommitId,
                target.rootId,
              );
              const changed: ChangedVersion[] = [];
              for (const blockId of target.blockIds) {
                const block = blocks.get(blockId);
                if (!block || block.deleted) continue;
                const properties = rewriteUsages(
                  propertySpecsFor(def, block.type),
                  block.properties,
                  fromAssetId,
                  toAssetId,
                  { dropCrop },
                );
                if (properties === block.properties) continue;
                changed.push({
                  blockId,
                  type: block.type,
                  properties,
                  children: block.children,
                });
              }
              if (changed.length === 0) return null;
              const { commit } = await writeCommit(tx, def, {
                rootId: target.rootId,
                branchId: target.branchId,
                parentCommitId: branch.headCommitId,
                message: `Replace asset ${fromAssetId} with ${toAssetId}`,
                createdBy: userId,
                changed,
              });
              return commit.id;
            });
            results.push({ ...base, ok: true, commitId, error: null });
          } catch (err) {
            results.push({
              ...base,
              ok: false,
              commitId: null,
              error: errorCode(err),
            });
          }
        }
        return { results, cropDropped: dropCrop, notRewritten };
      },
    ),

    /**
     * Usage counts for many assets at once (grid badges), read from the index on every call: per asset, the roots using it in `scope` and the published roots using it. Assets outside the caller's scope are left out.
     * @param assetIds - Up to 200 asset ids.
     * @param scope - `live` (default), `published` or `history`.
     * @returns `{ counts: Record<assetId, { roots, published }> }`.
     * @example await cmsClient.media.getAssetUsageCounts({ assetIds: ['ast_...'] })
     */
    getAssetUsageCounts: createCMSEndpoint(
      '/media/getAssetUsageCounts',
      {
        method: 'POST',
        body: z.object({
          assetIds: z.array(z.string()).min(1).max(200),
          scope: scopeSchema.optional(),
        }),
        metadata: cmsMeta({}, { operation: 'read', ...MEDIA_META }),
      },
      async (ctx) => {
        const { scope } = ctx.context;
        const ids = await assertAssetsInScope(
          ctx.body.assetIds,
          scope.assets?.where,
        );
        return {
          counts: await assetUsageCounts(
            db,
            ids,
            ctx.body.scope ?? 'live',
            crossScopeColumns(scope.roots),
          ),
        };
      },
    ),

    /**
     * Registers a use of an asset outside the CMS, pushed by the integration
     * that uses it (a newsletter, another site). The entry shows in the
     * external group of `getAssetUsages` and warns when the asset is
     * archived; it never blocks archiving. Integrations remove their own
     * entries with `removeExternalUsage`.
     *
     * @param assetId - An asset in the caller's scope.
     * @param consumer - Names the integration, 1 to 100 characters.
     * @param url - Where the asset is used: an http(s) URL without credentials.
     * @returns `{ registered: true }`; registering the same usage again keeps one entry.
     * @throws EXTERNAL_USAGE_NOT_CONFIGURED without `media.externalUsage`.
     * @throws ASSET_NOT_FOUND if the asset is not in the caller's scope.
     * @example await cmsClient.media.registerExternalUsage({ assetId: 'ast_...', consumer: 'newsletter', url: 'https://news.example.com/2026-10' })
     */
    registerExternalUsage: createCMSEndpoint(
      '/media/registerExternalUsage',
      {
        method: 'POST',
        body: z.object({
          assetId: z.string(),
          consumer: z.string().trim().min(1).max(100),
          url: externalUrl,
        }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const store = registry();
        const [asset] = await assertAssetsInScope(
          [ctx.body.assetId],
          ctx.context.scope.assets?.where,
        );
        if (!asset) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: errorMessages.assetNotFound(ctx.body.assetId),
          });
        }
        await store.register({
          assetId: asset,
          consumer: ctx.body.consumer,
          url: ctx.body.url,
        });
        return { registered: true as const };
      },
    ),

    /**
     * Removes external usages registered by `registerExternalUsage`: one
     * usage, or every usage of `consumer` for the asset without `url`.
     *
     * @param assetId - An asset in the caller's scope.
     * @param consumer - The integration that registered the usage.
     * @param url - The usage to remove; omitted removes all of `consumer`.
     * @returns `{ removed }`, the number of entries removed.
     * @throws EXTERNAL_USAGE_NOT_CONFIGURED without `media.externalUsage`.
     * @throws ASSET_NOT_FOUND if the asset is not in the caller's scope.
     */
    removeExternalUsage: createCMSEndpoint(
      '/media/removeExternalUsage',
      {
        method: 'POST',
        body: z.object({
          assetId: z.string(),
          consumer: z.string().trim().min(1).max(100),
          url: z.string().max(2048).optional(),
        }),
        metadata: cmsMeta({}, { operation: 'update', ...MEDIA_META }),
      },
      async (ctx) => {
        const store = registry();
        const [asset] = await assertAssetsInScope(
          [ctx.body.assetId],
          ctx.context.scope.assets?.where,
        );
        if (!asset) {
          throw new CMSError('ASSET_NOT_FOUND', {
            message: errorMessages.assetNotFound(ctx.body.assetId),
          });
        }
        const removed = await store.remove({
          assetId: asset,
          consumer: ctx.body.consumer,
          url: ctx.body.url,
        });
        return { removed };
      },
    ),
  };
}

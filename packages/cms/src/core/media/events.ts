import type { RealtimeRuntime } from '../realtime/types';
import type { ResolvedScope } from '../types/definitions';

export type MediaAssetEvent =
  | 'media.asset.created'
  | 'media.asset.updated'
  | 'media.asset.replaced'
  | 'media.asset.archived'
  | 'media.asset.restored'
  | 'media.asset.purged'
  | 'media.rendition.created';

export type MediaFolderEvent =
  | 'media.folder.created'
  | 'media.folder.renamed'
  | 'media.folder.moved'
  | 'media.folder.deleted';

export type MediaExportEvent = 'media.export.ready' | 'media.export.failed';

export type MediaAssetEventPayload = {
  tenant: string | null;
  assetId: string;
  revisionId?: string;
  /** `media.asset.purged`: the caller's reason code, never free text. */
  reason?: string;
  updatedAt: string;
};

export type MediaFolderEventPayload = {
  tenant: string | null;
  folderId: string;
  updatedAt: string;
};

/** `media.export.ready` and `media.export.failed`: poll `getZipExport` for details. */
export type MediaExportEventPayload = {
  tenant: string | null;
  exportId: string;
  updatedAt: string;
};

/** `media`, or `media:<channelKey>` under a scoping plugin. */
export function mediaChannel(
  scope?: Pick<ResolvedScope, 'channelKey'>,
): string {
  return scope?.channelKey ? `media:${scope.channelKey}` : 'media';
}

/**
 * Publishes media events after the write committed. Best effort: delivery
 * failures are logged and never fail the request. Does nothing without a
 * realtime runtime.
 */
export async function emitMediaEvents(
  realtime: RealtimeRuntime | undefined,
  scope: Pick<ResolvedScope, 'channelKey'> | undefined,
  events: (
    | {
        event: MediaAssetEvent;
        assetId: string;
        revisionId?: string;
        reason?: string;
      }
    | { event: MediaFolderEvent; folderId: string }
    | { event: MediaExportEvent; exportId: string }
  )[],
): Promise<void> {
  if (!realtime || events.length === 0) return;
  const channel = mediaChannel(scope);
  const tenant = scope?.channelKey ?? null;
  const updatedAt = new Date().toISOString();
  for (const item of events) {
    let payload:
      | MediaAssetEventPayload
      | MediaFolderEventPayload
      | MediaExportEventPayload;
    if ('exportId' in item) {
      payload = { tenant, exportId: item.exportId, updatedAt };
    } else if ('assetId' in item) {
      const assetPayload: MediaAssetEventPayload = {
        tenant,
        assetId: item.assetId,
        updatedAt,
      };
      if (item.revisionId) assetPayload.revisionId = item.revisionId;
      if (item.reason) assetPayload.reason = item.reason;
      payload = assetPayload;
    } else {
      payload = { tenant, folderId: item.folderId, updatedAt };
    }
    try {
      await realtime.publish(channel, item.event, payload);
    } catch (err) {
      console.error(`[cms] media event ${item.event} failed:`, err);
    }
  }
}

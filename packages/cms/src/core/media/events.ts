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

export type MediaAssetEventPayload = {
  tenant: string | null;
  assetId: string;
  revisionId?: string;
  updatedAt: string;
};

export type MediaFolderEventPayload = {
  tenant: string | null;
  folderId: string;
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
    | { event: MediaAssetEvent; assetId: string; revisionId?: string }
    | { event: MediaFolderEvent; folderId: string }
  )[],
): Promise<void> {
  if (!realtime || events.length === 0) return;
  const channel = mediaChannel(scope);
  const tenant = scope?.channelKey ?? null;
  const updatedAt = new Date().toISOString();
  for (const item of events) {
    let payload: MediaAssetEventPayload | MediaFolderEventPayload;
    if ('assetId' in item) {
      const assetPayload: MediaAssetEventPayload = {
        tenant,
        assetId: item.assetId,
        updatedAt,
      };
      if (item.revisionId) assetPayload.revisionId = item.revisionId;
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

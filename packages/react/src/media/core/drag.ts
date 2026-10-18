/**
 * The native drag payload of assets dragged out of the library: a custom
 * type for createcms drop targets (the editor canvas, a folder), plus
 * `text/uri-list`, `text/plain` and Chrome's `DownloadURL` for other apps
 * and the desktop. Its data is readable only in the `drop` event; during
 * `dragover` a target can check `types` alone.
 */

export const ASSET_DRAG_TYPE = 'application/x-createcms-asset+json';

export type AssetDragPayload = { ids: string[]; version: 1 };

export type DragAsset = {
  id: string;
  mimeType: string;
  /** The download file name. */
  name: string;
  /** An absolute URL another app can fetch: public, or signed for a download. */
  url?: string | null;
};

type DataTransferWritable = {
  setData(type: string, data: string): void;
  effectAllowed?: string;
};

type DataTransferReadable = {
  getData(type: string): string;
};

/** `name` safe inside `DownloadURL`, whose fields are separated by `:`. */
function downloadName(name: string): string {
  return name.replace(/[:\r\n]/g, '_') || 'download';
}

/**
 * Writes `assets` into a `dragstart` data transfer. `DownloadURL` (drag to
 * the desktop in Chromium) is set only for a single asset with a `url`.
 */
export function writeAssetDrag(
  dataTransfer: DataTransferWritable,
  assets: readonly DragAsset[],
): void {
  const payload: AssetDragPayload = {
    ids: assets.map((asset) => asset.id),
    version: 1,
  };
  dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(payload));
  const urls = assets
    .map((asset) => asset.url)
    .filter((url): url is string => !!url);
  if (urls.length > 0) dataTransfer.setData('text/uri-list', urls.join('\r\n'));
  dataTransfer.setData(
    'text/plain',
    urls.length > 0 ? urls.join('\n') : assets.map((a) => a.name).join('\n'),
  );
  const [single] = assets;
  if (assets.length === 1 && single.url) {
    dataTransfer.setData(
      'DownloadURL',
      `${single.mimeType}:${downloadName(single.name)}:${single.url}`,
    );
  }
  dataTransfer.effectAllowed = 'copyMove';
}

/** Whether a drag carries assets (usable in `dragenter`/`dragover`). */
export function hasAssetDrag(types: ArrayLike<string> | null | undefined) {
  return !!types && Array.from(types).includes(ASSET_DRAG_TYPE);
}

/** Validates a serialized payload; `null` for anything else. */
export function parseAssetDragPayload(text: string): AssetDragPayload | null {
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const { ids, version } = value as { ids?: unknown; version?: unknown };
  if (version !== 1 || !Array.isArray(ids)) return null;
  const valid = ids.filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  return valid.length > 0 ? { ids: valid, version: 1 } : null;
}

/** The asset payload of a `drop` event, or `null`. */
export function readAssetDrag(
  dataTransfer: DataTransferReadable | null | undefined,
): AssetDragPayload | null {
  if (!dataTransfer) return null;
  return parseAssetDragPayload(dataTransfer.getData(ASSET_DRAG_TYPE));
}

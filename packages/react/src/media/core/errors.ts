/**
 * Error codes the media library translates. Server and upload-client codes
 * pass through as they are; anything else becomes `UNKNOWN`. The core never
 * carries display text: parts translate codes through the catalog.
 */
export type MediaErrorCode =
  | 'ASSET_ACCESS_DENIED'
  | 'ASSET_NOT_FOUND'
  | 'CANNOT_MOVE_INTO_DESCENDANT'
  | 'CANNOT_MOVE_INTO_SELF'
  | 'CANNOT_REPLACE_VARIANT'
  | 'FILE_TOO_LARGE'
  | 'FOLDER_HAS_CONTENT'
  | 'FOLDER_NAME_TAKEN'
  | 'FOLDER_NOT_FOUND'
  | 'INVALID_FILE_TYPE'
  | 'NETWORK_ERROR'
  | 'PARENT_NOT_FOUND'
  | 'SLUG_GENERATION_FAILED'
  | 'STORAGE_UNSUPPORTED'
  | 'TOO_MANY_FILES'
  | 'UNSUPPORTED'
  | 'UPLOAD_EXPIRED'
  | 'UPLOAD_FAILED'
  | 'UPLOAD_NOT_FOUND'
  | 'UPLOAD_TOKEN_INVALID'
  | 'VERSION_CONFLICT';

/**
 * The code of a thrown client error (`{ code }`, `{ body: { code } }` or
 * `{ error: { code } }`), or `undefined`.
 */
export function errorCodeOf(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const top = error as {
    code?: unknown;
    body?: { code?: unknown };
    error?: { code?: unknown };
    status?: unknown;
    name?: unknown;
  };
  for (const candidate of [top.code, top.body?.code, top.error?.code]) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  if (top.name === 'TypeError') return 'NETWORK_ERROR';
  return undefined;
}

/** Whether `error` is the rejection of an aborted request. */
export function isAbortError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

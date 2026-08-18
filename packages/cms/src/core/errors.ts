import { APIError } from 'better-call';

import type { CMSErrorCode } from '../errors-data';

import { CMS_ERRORS } from '../errors-data';

// Re-export the pure error data so this module's public API is unchanged.
// Anything that only needs the data (e.g. the browser client) should import
// from '../errors-data' to avoid pulling `better-call` into the bundle.
export { CMS_ERRORS } from '../errors-data';
export type { CMSErrorCode } from '../errors-data';

type CmsErrorStatus = (typeof CMS_ERRORS)[CMSErrorCode]['status'];

export type CMSAPIError = APIError & {
  body?: {
    code?: CMSErrorCode | string;
  };
};

export function getCMSErrorCode(
  error: unknown,
): CMSErrorCode | (string & {}) | undefined {
  if (error instanceof CMSError) {
    return error.cmsCode;
  }

  if (error instanceof APIError) {
    const code = (error as CMSAPIError).body?.code;
    if (!code) {
      return undefined;
    }
    // Recognized core code (literal-typed for autocomplete); otherwise surface
    // the raw plugin/unknown code so callers can still match on it.
    return code in CMS_ERRORS ? (code as CMSErrorCode) : code;
  }

  return undefined;
}

export function isCMSError(
  error: unknown,
  code?: CMSErrorCode,
): error is CMSAPIError {
  const cmsCode = getCMSErrorCode(error);

  if (!cmsCode) {
    return false;
  }

  return code ? cmsCode === code : true;
}

/**
 * Type-safe CMS error that extends better-call's APIError.
 * The `code` parameter is a string-literal union of all CMS error codes,
 * so typos are caught at compile time.
 */
export class CMSError extends APIError {
  public readonly cmsCode: CMSErrorCode;

  constructor(
    code: CMSErrorCode,
    overrides?: { message?: string; data?: Record<string, unknown> },
  ) {
    // On purpose: index so a code absent from this module's map (a plugin
    // code, or a bundler stub of CMS_ERRORS) becomes a 500 CMSError instead
    // of TypeError on `def.status`.
    const def = (
      CMS_ERRORS as Record<
        string,
        { readonly status: CmsErrorStatus; readonly message: string }
      >
    )[code];
    super(def?.status ?? (500 as CmsErrorStatus), {
      message:
        overrides?.message ?? def?.message ?? `Unknown CMS error: ${code}`,
      code,
      // better-call serializes the whole body to the wire, so structured
      // `data` reaches the client (read back via `CMSClientError.data`).
      ...(overrides?.data ? { data: overrides.data } : {}),
    });
    this.cmsCode = code;
  }
}

export const errorMessages = {
  blockNotFound: (blockId: string) => `Block not found in snapshot: ${blockId}`,
  parentNotFound: (parentBlockId: string) =>
    `Parent block not found: ${parentBlockId}`,
  blockAlreadyDeleted: (blockId: string) =>
    `Block is already deleted: ${blockId}`,
  typeMismatch: (expected: string, actual: string) =>
    `Type mismatch: expected "${expected}" but block is "${actual}"`,
  folderNotFound: (folderId: string) => `Folder not found: ${folderId}`,
  folderHasContent: (folderId: string) =>
    `Folder contains assets or subfolders and cannot be deleted: ${folderId}`,
  tooManyFiles: (count: number, max: number) =>
    `Upload contains ${count} files but the maximum is ${max}`,
  fileTooLarge: (fileName: string, size: number, max: number) =>
    `File "${fileName}" is ${(size / 1024 / 1024).toFixed(1)}MB but the maximum is ${(max / 1024 / 1024).toFixed(1)}MB`,
  invalidFileType: (fileName: string, mimeType: string) =>
    `File "${fileName}" has disallowed MIME type "${mimeType}"`,
  uploadFailed: (fileName: string, status: number) =>
    `Server-side upload failed for "${fileName}" with status ${status}`,
  assetNotFound: (assetId: string) => `Asset not found: ${assetId}`,
} as const;

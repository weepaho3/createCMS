import type { CMSErrorCode } from './errors-data.generated';

import { CMS_ERRORS } from './errors-data.generated';

/**
 * Client-side CMS error thrown by `$fetch` when the server returns an error
 * response. A plain `Error` subclass (the server-side `CMSError` extends
 * better-call's `APIError`, which does not work in the browser).
 */
export class CMSClientError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly code: string | undefined;
  public readonly data?: Record<string, unknown>;

  constructor(errorBody: {
    message?: string;
    code?: string;
    status?: number;
    statusText?: string;
    data?: Record<string, unknown>;
  }) {
    super(errorBody.message ?? errorBody.statusText ?? 'Unknown CMS error');
    this.name = 'CMSClientError';
    this.status = errorBody.status ?? 500;
    this.statusText = errorBody.statusText ?? '';
    this.code = errorBody.code;
    this.data = errorBody.data;
  }

  get cmsCode(): CMSErrorCode | (string & {}) | undefined {
    if (this.code && this.code in CMS_ERRORS) {
      return this.code as CMSErrorCode;
    }
    // Plugin / unrecognized code: surface the raw string so callers can
    // still match on it.
    return this.code || undefined;
  }
}

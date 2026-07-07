import type { CMSErrorCode } from '../core/errors';

import { CMS_ERRORS } from '../core/errors';

/**
 * Client-side CMS error thrown by `$fetch` when the server returns an error
 * response. Unlike the server-side `CMSError` (which extends better-call's
 * `APIError`), this is a plain `Error` subclass that works in the browser.
 */
export class CMSClientError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly code: string | undefined;

  constructor(errorBody: {
    message?: string;
    code?: string;
    status?: number;
    statusText?: string;
  }) {
    super(errorBody.message ?? errorBody.statusText ?? 'Unknown CMS error');
    this.name = 'CMSClientError';
    this.status = errorBody.status ?? 500;
    this.statusText = errorBody.statusText ?? '';
    this.code = errorBody.code;
  }

  get cmsCode(): CMSErrorCode | (string & {}) | undefined {
    if (this.code && this.code in CMS_ERRORS) {
      // Recognized core code (literal-typed for autocomplete).
      return this.code as CMSErrorCode;
    }
    // Plugin / unrecognized code — surface the raw string so callers can
    // still match on it (e.g. `err.cmsCode === 'OPTIMIZATION_FAILED'`).
    return this.code || undefined;
  }
}

import { CMSError } from '../errors';

export type StorageCapabilities = {
  signedUpload: {
    supported: boolean;
    contentType: boolean;
    contentLength: boolean;
  };
  signedUrl: { supported: boolean; disposition: boolean; maxExpiresIn: number };
  rangeRead: boolean;
};

export type StorageObjectAcl = 'private' | 'public-read';

export type StorageAdapter = {
  readonly name: string;
  /** Anything not declared here counts as unsupported and is checked before any I/O. */
  readonly capabilities: StorageCapabilities;
  put(
    key: string,
    body: Blob | ArrayBuffer | Uint8Array,
    opts: {
      contentType: string;
      contentLength: number;
      acl?: StorageObjectAcl;
    },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  /** `null` when no object exists at `key`. */
  head(key: string): Promise<{
    contentLength: number | null;
    contentType: string | null;
  } | null>;
  /** Bytes `start..end` inclusive; `null` when no object exists at `key`. */
  getRange(key: string, start: number, end: number): Promise<Uint8Array | null>;
  /** `headers` are the request headers the uploader must send with the PUT. */
  signPut(
    key: string,
    opts: {
      contentType: string;
      contentLength: number;
      expiresIn: number;
      acl?: StorageObjectAcl;
    },
  ): Promise<{ url: string; headers: Record<string, string> }>;
  signGet(
    key: string,
    opts: { expiresIn: number; responseContentDisposition?: string },
  ): Promise<string>;
};

/** Thrown by adapters for backend failures; routes map it to status 500. */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

export function requireCapability(
  adapter: StorageAdapter,
  check: (c: StorageCapabilities) => boolean,
  what: string,
): void {
  if (!check(adapter.capabilities)) {
    throw new CMSError('STORAGE_UNSUPPORTED', {
      message: `Storage adapter "${adapter.name}" does not support ${what}`,
    });
  }
}

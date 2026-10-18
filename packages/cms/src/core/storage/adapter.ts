import { CMSError } from '../errors';

/**
 * What a storage backend supports. Anything declared `false` is checked with
 * {@link requireCapability} before any I/O.
 */
export type StorageCapabilities = {
  /** Presigned PUT; whether the signature binds content type and length. */
  signedPut: {
    supported: boolean;
    contentType: boolean;
    contentLength: boolean;
  };
  /** Presigned POST policies (browser form uploads with size conditions). */
  signedPost: boolean;
  /** Presigned GET; whether a response content disposition can be bound. */
  signedGet: { supported: boolean; disposition: boolean; maxExpiresIn: number };
  rangeRead: boolean;
  copy: boolean;
  list: boolean;
  deleteMany: boolean;
  multipart: { supported: boolean; minPartSize: number; maxParts: number };
  /** Per-object ACL headers (`x-amz-acl`) are accepted. */
  objectAcl: boolean;
  /** `If-None-Match: *` on PUT. */
  conditionalPut: boolean;
  checksum: {
    sha256Put: boolean;
    crc64nvmeFullObject: boolean;
    contentMd5Part: boolean;
  };
  /** CORS rules can be set through the S3 API. */
  corsConfigurable: boolean;
  /** Lifecycle rules (e.g. `AbortIncompleteMultipartUpload`) can be set. */
  lifecycle: boolean;
  /** Documented request rate limit per bucket, when the provider has one. */
  requestsPerSecond?: number;
  /** Largest single PUT in bytes, when below the S3 limit of 5 GiB. */
  maxSinglePutSize?: number;
};

export type StorageObjectAcl = 'private' | 'public-read';

export type StorageListResult = {
  keys: { key: string; size: number; lastModified: Date | null }[];
  /** Pass to the next `list` call; `null` on the last page. */
  cursor: string | null;
};

export type StorageAdapter = {
  readonly name: string;
  readonly capabilities: StorageCapabilities;
  put(
    key: string,
    body: Blob | ArrayBuffer | Uint8Array,
    opts: {
      contentType: string;
      contentLength: number;
      acl?: StorageObjectAcl;
      cacheControl?: string;
      /** `true` fails when an object already exists at `key`. */
      ifNoneMatch?: boolean;
    },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  /** `null` when no object exists at `key`. */
  head(key: string): Promise<{
    contentLength: number | null;
    contentType: string | null;
    cacheControl?: string | null;
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
      cacheControl?: string;
      /** Base64 SHA-256 of the body, bound as `x-amz-checksum-sha256`. */
      sha256?: string;
    },
  ): Promise<{ url: string; headers: Record<string, string> }>;
  signGet(
    key: string,
    opts: {
      expiresIn: number;
      responseContentDisposition?: string;
      responseContentType?: string;
    },
  ): Promise<string>;
  /**
   * Server-side copy. Without `metadata` the destination keeps the source's
   * content type and cache control; with it, both are replaced.
   */
  copy?(
    sourceKey: string,
    destinationKey: string,
    metadata?: { contentType: string; cacheControl: string },
  ): Promise<void>;
  /** Deletes up to 1000 keys per call; missing keys are not an error. */
  deleteMany?(keys: string[]): Promise<void>;
  /** S3 multipart uploads; present when `capabilities.multipart.supported`. */
  multipart?: StorageMultipart;
  /** Keys under `prefix`, in key order, paged by `cursor`. */
  list?(
    prefix: string,
    opts?: { cursor?: string | null; limit?: number },
  ): Promise<StorageListResult>;
};

/** One part a multipart upload already holds. */
export type StoragePart = { partNumber: number; size: number; etag: string };

export type StorageMultipart = {
  /** Starts an upload to `key`; returns its upload id. */
  create(
    key: string,
    opts: {
      contentType: string;
      acl?: StorageObjectAcl;
      cacheControl?: string;
    },
  ): Promise<string>;
  /** A presigned PUT for one part, bound to its exact `contentLength`. */
  signPart(
    key: string,
    uploadId: string,
    opts: { partNumber: number; contentLength: number; expiresIn: number },
  ): Promise<string>;
  /** One page of uploaded parts after `marker` (a part number). */
  listParts(
    key: string,
    uploadId: string,
    opts?: { marker?: number | null },
  ): Promise<{ parts: StoragePart[]; marker: number | null }>;
  /** Assembles the object from `parts` in order. */
  complete(
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void>;
  /** Discards the upload and its parts; an unknown upload is not an error. */
  abort(key: string, uploadId: string): Promise<void>;
};

/** Thrown by adapters for backend failures; routes map it to status 500. */
export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

/** Throws `STORAGE_UNSUPPORTED` naming `what` unless `check` passes. */
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

import type { MediaConfig, S3Client } from '../../types/s3';
import type { StorageAdapter } from '../adapter';

import { createS3Client } from './client';
import {
  deleteObject,
  getObjectRange,
  headObject,
  putObject,
  signGetObject,
  signPutObject,
} from './utils';

/**
 * Wraps the S3 helpers as a `StorageAdapter`. The `S3Client` is created on
 * the first storage call, so a config without credentials fails only when
 * storage is used.
 */
export function createS3StorageAdapter(config: MediaConfig): StorageAdapter {
  const bucket = config.bucketName;
  let client: S3Client | null = null;
  const s3 = () => (client ??= createS3Client(config));

  return {
    name: `s3:${config.provider}`,
    capabilities: {
      signedUpload: { supported: true, contentType: true, contentLength: true },
      signedUrl: { supported: true, disposition: true, maxExpiresIn: 604800 },
      rangeRead: true,
    },
    async put(key, body, opts) {
      await putObject(s3(), {
        bucket,
        key,
        body:
          body instanceof Uint8Array ? new Blob([new Uint8Array(body)]) : body,
        contentType: opts.contentType,
        contentLength: opts.contentLength,
        acl: opts.acl,
      });
    },
    async delete(key) {
      await deleteObject(s3(), { bucket, key });
    },
    async head(key) {
      return headObject(s3(), { bucket, key });
    },
    async getRange(key, start, end) {
      return getObjectRange(s3(), { bucket, key, start, end });
    },
    async signPut(key, opts) {
      const url = await signPutObject(s3(), {
        bucket,
        key,
        contentType: opts.contentType,
        contentLength: opts.contentLength,
        expiresIn: opts.expiresIn,
        acl: opts.acl,
      });
      const headers: Record<string, string> = {
        'Content-Type': opts.contentType,
      };
      if (opts.acl) headers['x-amz-acl'] = opts.acl;
      return { url, headers };
    },
    async signGet(key, opts) {
      return signGetObject(s3(), {
        bucket,
        key,
        expiresIn: opts.expiresIn,
        responseContentDisposition: opts.responseContentDisposition,
      });
    },
  };
}

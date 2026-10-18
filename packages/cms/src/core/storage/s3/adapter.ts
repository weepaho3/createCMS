import type { MediaConfig, S3Client } from '../../types/s3';
import type { StorageAdapter, StorageCapabilities } from '../adapter';

import { createS3Client } from './client';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  listUploadParts,
  signUploadPart,
} from './multipart';
import {
  mergeCapabilities,
  providerCapabilities,
  type StoragePreset,
} from './presets';
import {
  copyObject,
  deleteObject,
  deleteObjects,
  getObjectRange,
  headObject,
  listObjects,
  putObject,
  signGetObject,
  signPutObject,
} from './utils';

function presetFor(config: MediaConfig): StoragePreset {
  switch (config.provider) {
    case 'aws':
      return 'aws';
    case 'cloudflare':
      return 'r2';
    case 'digitalOcean':
      return 'doSpaces';
    case 'custom':
      return config.preset ?? 'generic';
  }
}

/** The provider preset for `config` with `config.capabilities` applied. */
export function resolveS3Capabilities(
  config: MediaConfig,
): StorageCapabilities {
  return mergeCapabilities(
    providerCapabilities[presetFor(config)],
    config.capabilities,
  );
}

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
    capabilities: resolveS3Capabilities(config),
    async put(key, body, opts) {
      await putObject(s3(), {
        bucket,
        key,
        body:
          body instanceof Uint8Array ? new Blob([new Uint8Array(body)]) : body,
        contentType: opts.contentType,
        contentLength: opts.contentLength,
        acl: opts.acl,
        cacheControl: opts.cacheControl,
        ifNoneMatch: opts.ifNoneMatch,
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
        cacheControl: opts.cacheControl,
        sha256: opts.sha256,
      });
      const headers: Record<string, string> = {
        'Content-Type': opts.contentType,
      };
      if (opts.acl) headers['x-amz-acl'] = opts.acl;
      if (opts.cacheControl) headers['Cache-Control'] = opts.cacheControl;
      if (opts.sha256) headers['x-amz-checksum-sha256'] = opts.sha256;
      return { url, headers };
    },
    async signGet(key, opts) {
      return signGetObject(s3(), {
        bucket,
        key,
        expiresIn: opts.expiresIn,
        responseContentDisposition: opts.responseContentDisposition,
        responseContentType: opts.responseContentType,
      });
    },
    async copy(sourceKey, destinationKey, metadata) {
      await copyObject(s3(), { bucket, sourceKey, destinationKey, metadata });
    },
    async deleteMany(keys) {
      await deleteObjects(s3(), { bucket, keys });
    },
    multipart: {
      create: (key, opts) =>
        createMultipartUpload(s3(), { bucket, key, ...opts }),
      signPart: (key, uploadId, opts) =>
        signUploadPart(s3(), { bucket, key, uploadId, ...opts }),
      listParts: (key, uploadId, opts) =>
        listUploadParts(s3(), { bucket, key, uploadId, marker: opts?.marker }),
      complete: (key, uploadId, parts) =>
        completeMultipartUpload(s3(), { bucket, key, uploadId, parts }),
      abort: (key, uploadId) =>
        abortMultipartUpload(s3(), { bucket, key, uploadId }),
    },
    async list(prefix, opts) {
      return listObjects(s3(), {
        bucket,
        prefix,
        cursor: opts?.cursor,
        limit: opts?.limit,
      });
    },
  };
}

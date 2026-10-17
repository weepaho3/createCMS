import type { StorageAdapter } from '../core/storage/adapter';

import {
  mergeCapabilities,
  providerCapabilities,
  type StorageCapabilitiesOverride,
} from '../core/storage/s3/presets';

export type MemoryObject = {
  body: Uint8Array;
  contentType: string;
  cacheControl: string | null;
};

/**
 * A `StorageAdapter` over an in-memory map. Signed URLs are `memory://<key>`
 * and are not fetchable. Default capabilities are the generic S3 preset with
 * signed PUT and signed GET switched off; `overrides` change single flags.
 * `objects` exposes the map for assertions.
 */
export function createMemoryStorage(
  overrides?: StorageCapabilitiesOverride,
): StorageAdapter & { objects: Map<string, MemoryObject> } {
  const store = new Map<string, MemoryObject>();

  return {
    name: 'memory',
    objects: store,
    capabilities: mergeCapabilities(
      mergeCapabilities(providerCapabilities.generic, {
        signedPut: {
          supported: false,
          contentType: false,
          contentLength: false,
        },
        signedGet: { supported: false, disposition: false, maxExpiresIn: 0 },
      }),
      overrides,
    ),
    async put(key, body, opts) {
      const bytes =
        body instanceof Blob
          ? new Uint8Array(await body.arrayBuffer())
          : new Uint8Array(body);
      store.set(key, {
        body: bytes,
        contentType: opts.contentType,
        cacheControl: opts.cacheControl ?? null,
      });
    },
    async delete(key) {
      store.delete(key);
    },
    async head(key) {
      const obj = store.get(key);
      if (!obj) return null;
      return {
        contentLength: obj.body.byteLength,
        contentType: obj.contentType,
        cacheControl: obj.cacheControl,
      };
    },
    async getRange(key, start, end) {
      const obj = store.get(key);
      if (!obj) return null;
      return obj.body.slice(start, end + 1);
    },
    async signPut(key) {
      return { url: `memory://${key}`, headers: {} };
    },
    async signGet(key) {
      return `memory://${key}`;
    },
    async copy(sourceKey, destinationKey, metadata) {
      const obj = store.get(sourceKey);
      if (!obj) throw new Error(`memory storage: no object at ${sourceKey}`);
      store.set(
        destinationKey,
        metadata ? { ...obj, ...metadata } : { ...obj },
      );
    },
    async deleteMany(keys) {
      for (const key of keys) store.delete(key);
    },
    async list(prefix, opts) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = opts?.cursor ? keys.indexOf(opts.cursor) + 1 : 0;
      const limit = opts?.limit ?? 1000;
      const page = keys.slice(start, start + limit);
      return {
        keys: page.map((key) => ({
          key,
          size: store.get(key)!.body.byteLength,
          lastModified: null,
        })),
        cursor: start + limit < keys.length ? page[page.length - 1] : null,
      };
    },
  };
}

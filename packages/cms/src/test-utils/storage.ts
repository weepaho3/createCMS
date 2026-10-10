import type {
  StorageAdapter,
  StorageCapabilities,
} from '../core/storage/adapter';

/**
 * A `StorageAdapter` over an in-memory map. Signed URLs are `memory://<key>`
 * and are not fetchable. Default capabilities declare no signed uploads and
 * no signed URLs; `rangeRead` is on.
 */
export function createMemoryStorage(
  overrides?: Partial<StorageCapabilities>,
): StorageAdapter {
  const store = new Map<string, { body: Uint8Array; contentType: string }>();

  return {
    name: 'memory',
    capabilities: {
      signedUpload: {
        supported: false,
        contentType: false,
        contentLength: false,
      },
      signedUrl: { supported: false, disposition: false, maxExpiresIn: 0 },
      rangeRead: true,
      ...overrides,
    },
    async put(key, body, opts) {
      const bytes =
        body instanceof Blob
          ? new Uint8Array(await body.arrayBuffer())
          : new Uint8Array(body);
      store.set(key, { body: bytes, contentType: opts.contentType });
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
  };
}

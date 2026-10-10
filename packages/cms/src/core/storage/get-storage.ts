import type { MediaConfig } from '../types/s3';
import type { StorageAdapter } from './adapter';

import { createS3StorageAdapter } from './s3/adapter';

/** One adapter per `MediaConfig` object, created on first use. */
const cache = new WeakMap<MediaConfig, StorageAdapter>();

export function getStorage(config: MediaConfig): StorageAdapter {
  let adapter = cache.get(config);
  if (!adapter) {
    adapter = config.storage ?? createS3StorageAdapter(config);
    cache.set(config, adapter);
  }
  return adapter;
}

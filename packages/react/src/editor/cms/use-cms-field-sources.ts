import * as React from 'react';

import type {
  CmsAssetListItem,
  CmsAssetListQuery,
  CmsAssetListResult,
  CmsCollectionRootsClient,
  CmsFieldSources,
  CmsMediaUploadState,
  CmsRootListItem,
  CmsRootListQuery,
  CmsRootListResult,
  CmsVariableListQuery,
  CmsVariableListResult,
  UseCmsFieldSourcesClient,
} from './types';

const RESERVED_COLLECTIONS = new Set(['media', 'variables', 'templates']);

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function cacheKey(kind: string, ...args: unknown[]): string {
  return stableStringify([kind, ...args]);
}

type CacheStore = {
  entries: Map<string, unknown>;
  assetById: Map<string, CmsAssetListItem>;
  rootById: Map<string, Map<string, CmsRootListItem>>;
};

function getRootIdMap(
  store: CacheStore,
  collection: string,
): Map<string, CmsRootListItem> {
  let map = store.rootById.get(collection);
  if (!map) {
    map = new Map();
    store.rootById.set(collection, map);
  }
  return map;
}

function collectionRoots(
  client: UseCmsFieldSourcesClient,
  collection: string,
): CmsCollectionRootsClient {
  if (RESERVED_COLLECTIONS.has(collection)) {
    throw new Error(
      `cms field sources: "${collection}" is not a collection namespace`,
    );
  }
  const ns = (client as Record<string, unknown>)[collection];
  if (!ns || typeof ns !== 'object') {
    throw new Error(
      `cms field sources: collection "${collection}" is not available`,
    );
  }
  const roots = ns as Partial<CmsCollectionRootsClient>;
  if (typeof roots.listRoots !== 'function') {
    throw new Error(
      `cms field sources: collection "${collection}" has no listRoots`,
    );
  }
  return roots as CmsCollectionRootsClient;
}

async function withCache<T>(
  store: CacheStore,
  key: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const existing = store.entries.get(key);
  if (existing !== undefined) {
    return existing instanceof Promise
      ? existing
      : Promise.resolve(existing as T);
  }
  const promise = fetcher()
    .then((result) => {
      store.entries.set(key, result);
      return result;
    })
    .catch((err) => {
      store.entries.delete(key);
      throw err;
    });
  store.entries.set(key, promise);
  return promise;
}

export function useCmsFieldSources(
  client: UseCmsFieldSourcesClient,
): CmsFieldSources {
  const clientRef = React.useRef(client);
  const cacheRef = React.useRef<CacheStore>({
    entries: new Map(),
    assetById: new Map(),
    rootById: new Map(),
  });

  return React.useMemo((): CmsFieldSources => {
    const store = cacheRef.current;

    return {
      assets: {
        async list(query?: CmsAssetListQuery): Promise<CmsAssetListResult> {
          const key = cacheKey('assets.list', query ?? null);
          const result = await withCache(store, key, () =>
            clientRef.current.media.listAssets({ query }),
          );
          for (const asset of result.assets) {
            store.assetById.set(asset.id, asset);
          }
          return result;
        },

        async get(ids: string[]): Promise<CmsAssetListItem[]> {
          if (ids.length === 0) return [];

          const missing: string[] = [];
          const missingSet = new Set<string>();
          for (const id of ids) {
            if (!store.assetById.has(id) && !missingSet.has(id)) {
              missing.push(id);
              missingSet.add(id);
            }
          }

          if (missing.length > 0) {
            const key = cacheKey('assets.get', missing);
            await withCache(store, key, async () => {
              const result = await clientRef.current.media.getAssets({
                query: { ids: missing },
              });
              for (const asset of result.assets) {
                store.assetById.set(asset.id, asset);
              }
              return result.assets;
            });
          }

          const ordered: CmsAssetListItem[] = [];
          const added = new Set<string>();
          for (const id of ids) {
            if (added.has(id)) continue;
            const asset = store.assetById.get(id);
            if (asset) {
              ordered.push(asset);
              added.add(id);
            }
          }
          return ordered;
        },

        useUpload(): CmsMediaUploadState {
          const hook = clientRef.current.media.useUploadAssets;
          if (typeof hook !== 'function') {
            throw new Error(
              'cms field sources: media.useUploadAssets is not available',
            );
          }
          return hook();
        },
      },

      roots: {
        async list(
          collection: string,
          query?: CmsRootListQuery,
        ): Promise<CmsRootListResult> {
          const key = cacheKey('roots.list', collection, query ?? null);
          const result = await withCache(store, key, () =>
            collectionRoots(clientRef.current, collection).listRoots({
              query,
            }),
          );
          const idMap = getRootIdMap(store, collection);
          for (const root of result.roots) {
            idMap.set(root.id, root);
          }
          return result;
        },

        async get(
          collection: string,
          rootId: string,
        ): Promise<CmsRootListItem> {
          const idMap = getRootIdMap(store, collection);
          const cached = idMap.get(rootId);
          if (cached) return cached;

          const key = cacheKey('roots.get', collection, rootId);
          const root = await withCache(store, key, () =>
            collectionRoots(clientRef.current, collection).getRoot({
              query: { rootId },
            }),
          );
          idMap.set(root.id, root);
          return root;
        },

        async bySlug(
          collection: string,
          slug: string,
          parentRootId?: string,
        ): Promise<CmsRootListItem> {
          const key = cacheKey(
            'roots.bySlug',
            collection,
            slug,
            parentRootId ?? null,
          );
          const root = await withCache(store, key, () =>
            collectionRoots(clientRef.current, collection).getRootBySlug({
              query: { slug, parentRootId },
            }),
          );
          getRootIdMap(store, collection).set(root.id, root);
          return root;
        },
      },

      variables: {
        async list(
          query?: CmsVariableListQuery,
        ): Promise<CmsVariableListResult> {
          const key = cacheKey('variables.list', query ?? null);
          return withCache(store, key, () =>
            clientRef.current.variables.list({ query }),
          );
        },
      },

      templates: {
        async defaults(
          collection: string,
          blockType: string,
        ): Promise<Record<string, string>> {
          const templates = clientRef.current.templates;
          if (!templates) {
            throw new Error('cms field sources: templates is not available');
          }
          const key = cacheKey('templates.defaults', collection, blockType);
          return withCache(store, key, async () => {
            const result = await templates.getTemplateDefaults({
              query: { collection, blockType },
            });
            return result.defaults;
          });
        },
      },
    };
  }, []);
}

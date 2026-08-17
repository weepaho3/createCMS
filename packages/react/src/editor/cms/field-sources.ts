import type { LinkValue } from '@createcms/schema';

import type { CmsFieldSources, CmsRootListItem } from './types';

export type AssetUrlOptions = {
  basePath?: string;
  format?: 'webp' | 'jpeg' | 'png';
  w?: number;
};

export function assetUrl(id: string, options: AssetUrlOptions = {}): string {
  if (!id) {
    throw new Error('cms field sources: assetUrl requires an id');
  }
  const base = (options.basePath ?? '/api/cms').replace(/\/+$/, '');
  const path = `${base}/media/asset/${encodeURIComponent(id)}`;
  const params = new URLSearchParams();
  if (options.format) params.set('format', options.format);
  if (options.w != null) params.set('w', String(options.w));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function labelFromRoot(root: CmsRootListItem): string {
  const props = root.properties ?? {};
  for (const key of ['title', 'label', 'name'] as const) {
    const value = props[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  if (root.slug) return root.slug;
  if (root.path) return root.path;
  return root.id;
}

export async function referenceLabel(
  collection: string,
  rootId: string,
  sources: CmsFieldSources,
): Promise<string> {
  try {
    const root = await sources.roots.get(collection, rootId);
    return labelFromRoot(root);
  } catch {
    return rootId;
  }
}

export async function linkLabel(
  value: LinkValue,
  sources: CmsFieldSources,
): Promise<string> {
  switch (value.kind) {
    case 'external':
      return value.url;
    case 'email':
      return value.email;
    case 'phone':
      return value.phone;
    case 'internal':
      return referenceLabel(value.collection, value.rootId, sources);
  }
}

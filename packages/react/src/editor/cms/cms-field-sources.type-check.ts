/**
 * Compile-time guarantees for useCmsFieldSources client duck-typing. Ships
 * nothing (no entry imports it) but is covered by `tsc --noEmit`.
 */
import type { LinkValue } from '@createcms/schema';

import type { useVariableSuggest } from './use-variable-suggest';
import type {
  CmsAssetListItem,
  CmsRootListItem,
  CmsVariableSuggest,
  UseCmsFieldSourcesClient,
} from './types';

type LiveClient = {
  media: {
    listAssets(args?: {
      query?: { limit?: number; cursor?: string };
    }): Promise<{
      assets: CmsAssetListItem[];
      total: number;
      hasMore: boolean;
      nextCursor: string | null;
    }>;
    getAssets(args: { query: { ids: string[] } }): Promise<{
      assets: CmsAssetListItem[];
    }>;
  };
  variables: {
    list(args?: {
      query?: { limit?: number; offset?: number; search?: string };
    }): Promise<{
      variables: { key: string; value: string; description?: string | null }[];
      total: number;
      hasMore: boolean;
    }>;
  };
  templates: {
    getTemplateDefaults(args: {
      query: { collection: string; blockType: string };
    }): Promise<{ defaults: Record<string, string> }>;
  };
  pages: {
    listRoots(args?: {
      query?: { limit?: number; offset?: number; search?: string };
    }): Promise<{
      roots: CmsRootListItem[];
      total: number;
      hasMore: boolean;
    }>;
    getRoot(args: { query: { rootId: string } }): Promise<CmsRootListItem>;
    getRootBySlug(args: {
      query: { slug: string; parentRootId?: string };
    }): Promise<CmsRootListItem>;
  };
  emails: {
    listRoots(args?: {
      query?: { limit?: number; offset?: number };
    }): Promise<{
      roots: CmsRootListItem[];
      total: number;
      hasMore: boolean;
    }>;
    getRoot(args: { query: { rootId: string } }): Promise<CmsRootListItem>;
    getRootBySlug(args: {
      query: { slug: string; parentRootId?: string };
    }): Promise<CmsRootListItem>;
  };
};

declare const liveClient: LiveClient;
const clientPin: UseCmsFieldSourcesClient = liveClient;
void clientPin;

declare const sources: import('./types').CmsFieldSources;
declare const link: LinkValue;
declare function linkLabel(
  value: LinkValue,
  fieldSources: import('./types').CmsFieldSources,
): Promise<string>;
void linkLabel(link, sources);

declare const suggest: CmsVariableSuggest;
const suggestPin: ReturnType<typeof useVariableSuggest> = suggest;
void suggestPin;

type MissingMediaClient = {
  variables: LiveClient['variables'];
  templates: LiveClient['templates'];
  pages: LiveClient['pages'];
};
declare const missingMedia: MissingMediaClient;
const badClient: UseCmsFieldSourcesClient = {
  // @ts-expect-error - listAssets is required on media
  media: {},
  variables: missingMedia.variables,
  templates: missingMedia.templates,
};
void badClient;

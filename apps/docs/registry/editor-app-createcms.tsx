// @registry editor-app-createcms@0.3.2
'use client';

import type {
  CmsBlocksMap,
  CmsDocumentClient,
  CmsTemplatesClient,
  UseCmsFieldSourcesClient,
} from '@createcms/react/editor/cms';
import type { MediaClient } from '@createcms/react/media';

import {
  assetUrl,
  cmsCanvasComponents,
  fromCollection,
  useCmsDocument,
  useCmsFieldSources,
} from '@createcms/react/editor/cms';
import { lazyRichTextAdapter } from '@createcms/react/editor/core';
import * as React from 'react';

import type { EditorAppDocument, EditorAppMode } from './editor-app';

import { EditorAppView } from './editor-app';
import { CmsSourcesProvider, cmsFields } from './editor-form-createcms';

const RESERVED_COLLECTIONS = new Set(['media', 'variables', 'templates']);

export type CmsEditorMode = EditorAppMode;

type CmsMediaClient = UseCmsFieldSourcesClient['media'];

export type CmsEditorClient = UseCmsFieldSourcesClient & {
  /** The full `MediaClient` surface enables the media picker's folders and uploads. */
  media: CmsMediaClient & Partial<MediaClient>;
  readonly [collection: string]: unknown;
};

export type CmsEditorProps = {
  client: CmsEditorClient;
  templates?: CmsTemplatesClient;
  collection: string;
  rootId: string;
  branchId: string;
  /** The `createBlocksMap` result: block components plus the collection definition. */
  blocks: CmsBlocksMap;
  mode?: CmsEditorMode;
  className?: string;
  requireCommitMessage?: boolean;
  children?: React.ReactNode;
};

function isMediaClient(
  media: CmsMediaClient & Partial<MediaClient>,
): media is CmsMediaClient & MediaClient {
  return (
    typeof media.listFolders === 'function' &&
    typeof media.createFolder === 'function' &&
    typeof media.moveAssets === 'function' &&
    typeof media.archiveAssets === 'function' &&
    typeof media.updateAssetsStatus === 'function' &&
    typeof media.useUploadAssets === 'function'
  );
}

function readDocumentClient(
  client: CmsEditorClient,
  collection: string,
): CmsDocumentClient {
  if (RESERVED_COLLECTIONS.has(collection)) {
    throw new Error(`CmsEditor: "${collection}" is not a collection namespace`);
  }
  const namespace = (client as Record<string, unknown>)[collection];
  if (!namespace || typeof namespace !== 'object') {
    throw new Error(
      `CmsEditor: collection "${collection}" is not available on client`,
    );
  }
  if (
    typeof (namespace as CmsDocumentClient).getBlockTree !== 'function' ||
    typeof (namespace as CmsDocumentClient).getBranch !== 'function' ||
    typeof (namespace as CmsDocumentClient).updateBlocks !== 'function'
  ) {
    throw new Error(
      `CmsEditor: collection "${collection}" is not a document client`,
    );
  }
  return namespace as CmsDocumentClient;
}

/**
 * `EditorAppView` over a createCMS collection: loads and saves through the
 * collection's document client, and wires the CMS field sources (assets,
 * references, links, variables) into the form.
 */
function CmsEditor({
  client,
  templates,
  collection,
  rootId,
  branchId,
  blocks,
  ...props
}: CmsEditorProps) {
  const documentClient = readDocumentClient(client, collection);
  // The editor compares the schema by identity: derive it once per map.
  const schema = React.useMemo(
    () => fromCollection(blocks._collection),
    [blocks],
  );
  const components = React.useMemo(() => cmsCanvasComponents(blocks), [blocks]);
  const doc = useCmsDocument({
    client: documentClient,
    definition: blocks._collection,
    rootId,
    branchId,
    templates: templates ?? client.templates,
    collection,
  });
  const sources = useCmsFieldSources(client);
  // On the proxy client every method is a function, so the guard only
  // distinguishes hand-written clients.
  const media = React.useMemo(() => {
    const m = client.media;
    return isMediaClient(m) ? m : undefined;
  }, [client]);
  const document = React.useMemo<EditorAppDocument>(
    () => ({
      doc: doc.doc,
      key: doc.key,
      status: doc.status,
      error: doc.error,
      persistence: doc.persistence,
      reload: doc.reload,
      onChange: doc.onChange,
    }),
    [doc],
  );

  return (
    <EditorAppView
      document={document}
      schema={schema}
      components={components}
      resolve={doc.resolve}
      fields={cmsFields}
      richText={richText}
      renderProviders={(children) => (
        <CmsSourcesProvider sources={sources} media={media}>
          {children}
        </CmsSourcesProvider>
      )}
      {...props}
    />
  );
}

/**
 * Tiptap for `richText` fields with CMS asset URLs, loaded the first time
 * one is edited so it stays out of the page's initial bundle.
 */
const richText = lazyRichTextAdapter(() =>
  import('@createcms/react/editor/richtext').then((m) =>
    m.createTiptapAdapter({ resolveAsset: (id) => assetUrl(id) }),
  ),
);

export { CmsEditor };

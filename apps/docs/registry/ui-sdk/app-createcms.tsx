// @registry ui-sdk-editor-createcms@0.3.2
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

import type { EditorAppDocument, EditorAppMode } from './app';

import { EditorAppView } from './app';
import { CmsSourcesProvider, cmsFields } from './fields-createcms';

type CmsMedia = UseCmsFieldSourcesClient['media'];

export type CmsEditorClient = UseCmsFieldSourcesClient & {
  media: CmsMedia & Partial<MediaClient>;
  readonly [collection: string]: unknown;
};

export type CmsEditorProps = {
  client: CmsEditorClient;
  templates?: CmsTemplatesClient;
  collection: string;
  rootId: string;
  branchId: string;
  blocks: CmsBlocksMap;
  mode?: EditorAppMode;
  className?: string;
  requireCommitMessage?: boolean;
  children?: React.ReactNode;
};

const RESERVED = new Set(['media', 'variables', 'templates']);
const MEDIA_METHODS = [
  'listFolders',
  'createFolder',
  'moveAssets',
  'archiveAssets',
  'updateAssetsStatus',
  'useUploadAssets',
] as const;

function documentClient(
  client: CmsEditorClient,
  collection: string,
): CmsDocumentClient {
  const namespace = RESERVED.has(collection)
    ? undefined
    : (client as Record<string, unknown>)[collection];
  const methods = ['getBlockTree', 'getBranch', 'updateBlocks'] as const;
  if (
    !namespace ||
    typeof namespace !== 'object' ||
    methods.some(
      (m) => typeof (namespace as Record<string, unknown>)[m] !== 'function',
    )
  ) {
    throw new Error(
      `CmsEditor: "${collection}" is not a document collection on the client`,
    );
  }
  return namespace as CmsDocumentClient;
}

const richText = lazyRichTextAdapter(() =>
  import('@createcms/react/editor/richtext').then((m) =>
    m.createTiptapAdapter({ resolveAsset: (id) => assetUrl(id) }),
  ),
);

export function CmsEditor({
  client,
  templates,
  collection,
  rootId,
  branchId,
  blocks,
  ...props
}: CmsEditorProps) {
  const docs = documentClient(client, collection);
  // The editor compares the schema by identity: derive it once per map.
  const schema = React.useMemo(
    () => fromCollection(blocks._collection),
    [blocks],
  );
  const components = React.useMemo(() => cmsCanvasComponents(blocks), [blocks]);
  const doc = useCmsDocument({
    client: docs,
    definition: blocks._collection,
    rootId,
    branchId,
    templates: templates ?? client.templates,
    collection,
  });
  const sources = useCmsFieldSources(client);
  const media = React.useMemo(
    () =>
      MEDIA_METHODS.every((m) => typeof client.media[m] === 'function')
        ? (client.media as MediaClient)
        : undefined,
    [client],
  );
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

'use client';

import type {
  CmsBlocksMap,
  CmsDocumentClient,
  CmsDocumentError,
  CmsTemplatesClient,
  UseCmsFieldSourcesClient,
} from '@createcms/react/editor/cms';
import type { MediaClient } from '@createcms/react/media';

import { Editor, useSave, useSaveConflict } from '@createcms/react/editor';
import { Canvas } from '@createcms/react/editor/canvas';
import {
  assetUrl,
  cmsCanvasComponents,
  fromCollection,
  useCmsDocument,
  useCmsFieldSources,
} from '@createcms/react/editor/cms';
import { lazyRichTextAdapter } from '@createcms/react/editor/core';
import * as React from 'react';

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import {
  BlockToolbar,
  DragPreview,
  DropIndicator,
  FieldRing,
  HoverRing,
  InlineText,
  InsertButton,
  Overlay,
  SelectionRing,
} from './editor-canvas';
import { CmsSourcesProvider, cmsFields, FormSurface } from './editor-form';
import { EditorShell, useDeviceFrame, useEditorChrome } from './editor-shell';

const RESERVED_COLLECTIONS = new Set(['media', 'variables', 'templates']);

export type CmsEditorMode = 'canvas' | 'form';

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

function EditorLoadingSkeleton({ className }: { className?: string }) {
  return (
    <div
      data-slot="editor-app-loading"
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn('flex min-h-0 flex-1 flex-col', className)}
    >
      <span className="sr-only">Loading editor</span>
      <Skeleton className="h-12 w-full shrink-0 rounded-none" />
      <div className="flex min-h-0 flex-1">
        <Skeleton className="hidden w-64 shrink-0 rounded-none md:block" />
        <div className="min-h-0 min-w-0 flex-1 p-3">
          <Skeleton className="h-full min-h-64 w-full" />
        </div>
        <Skeleton className="hidden w-64 shrink-0 rounded-none md:block" />
      </div>
    </div>
  );
}

function EditorErrorAlert({
  error,
  onRetry,
  className,
}: {
  error: CmsDocumentError | null;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <Alert variant="destructive" aria-live="assertive" className={className}>
      <AlertTitle>
        {error?.message ?? 'Failed to load the document.'}
      </AlertTitle>
      <AlertDescription>
        {error?.fields?.length ? (
          <ul>
            {error.fields.map((field) => (
              <li key={`${field.blockId}-${field.key}`}>
                {field.key}: {field.message}
              </li>
            ))}
          </ul>
        ) : (
          'Retry to load the latest version.'
        )}
      </AlertDescription>
      <AlertAction>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </AlertAction>
    </Alert>
  );
}

function EditorErrorState({
  error,
  onRetry,
  className,
}: {
  error: CmsDocumentError | null;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      data-slot="editor-app-error"
      className={cn(
        'flex min-h-0 flex-1 flex-col items-center justify-center p-8',
        className,
      )}
    >
      <EditorErrorAlert
        error={error}
        onRetry={onRetry}
        className="w-full max-w-md"
      />
    </div>
  );
}

/** A save failure as the alert shows it: the server code, message and field findings. */
function saveErrorOf(error: Error | null): CmsDocumentError | null {
  if (!error) return null;
  const details =
    (error as { details?: Record<string, unknown> }).details ?? {};
  const code = typeof details.code === 'string' ? details.code : 'UNKNOWN';
  const fields = Array.isArray(details.fields)
    ? (details.fields as CmsDocumentError['fields'])
    : undefined;
  return { code, message: error.message, fields };
}

function SaveErrorBanner() {
  const { status, error, save } = useSave();
  if (status !== 'error' || !error) return null;
  return (
    <div data-slot="editor-app-error-banner">
      <EditorErrorAlert
        error={saveErrorOf(error)}
        onRetry={() => void save()}
        className="rounded-none border-x-0 border-t-0"
      />
    </div>
  );
}

function ConflictDialog({
  onReloadDocument,
}: {
  onReloadDocument: () => void;
}) {
  const conflict = useSaveConflict();
  const { error } = useSave();
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!conflict) setCopied(false);
  }, [conflict]);

  const reload = () => {
    // Without the server's document, reload the whole editor from the server.
    if (!conflict?.reload()) onReloadDocument();
  };

  return (
    <AlertDialog
      open={conflict !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) reload();
      }}
    >
      <AlertDialogContent data-slot="editor-app-conflict">
        <AlertDialogHeader>
          <AlertDialogTitle>Document conflict</AlertDialogTitle>
          <AlertDialogDescription>
            {error?.message ??
              'This document changed on the server since you loaded it. Load the server version, overwrite it with yours, or copy yours first.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void conflict?.copyMine().then(() => setCopied(true));
            }}
          >
            {copied ? 'Copied' : 'Copy mine'}
          </Button>
          <AlertDialogCancel type="button">
            Load server version
          </AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            onClick={() => {
              void conflict?.overwrite();
            }}
          >
            Overwrite
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CanvasOverlays() {
  const { setAddOpen } = useEditorChrome();

  return (
    <Overlay>
      <SelectionRing />
      <HoverRing />
      <FieldRing />
      <BlockToolbar side="top" align="start" />
      <InsertButton placement="between" onInsert={() => setAddOpen(true)} />
      <InsertButton placement="container" onInsert={() => setAddOpen(true)} />
      <DropIndicator />
      <DragPreview />
      <InlineText />
    </Overlay>
  );
}

function CmsEditor({
  client,
  templates,
  collection,
  rootId,
  branchId,
  blocks,
  mode = 'canvas',
  className,
  requireCommitMessage = false,
  children,
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

  const retry = () => {
    void doc.reload();
  };

  if (!doc.doc) {
    if (doc.status === 'error') {
      return (
        <EditorErrorState
          className={className}
          error={doc.error}
          onRetry={retry}
        />
      );
    }
    return <EditorLoadingSkeleton className={className} />;
  }

  return (
    <div
      data-slot="editor-app"
      data-mode={mode}
      className={cn(
        'relative flex min-h-0 flex-1 flex-col overflow-hidden',
        className,
      )}
    >
      {doc.status === 'error' && doc.error ? (
        <div data-slot="editor-app-error-banner">
          <EditorErrorAlert
            error={doc.error}
            onRetry={retry}
            className="rounded-none border-x-0 border-t-0"
          />
        </div>
      ) : null}
      <Editor.Root
        key={doc.key}
        schema={schema}
        defaultValue={doc.doc}
        persistence={doc.persistence}
        onChange={doc.onChange}
        fields={cmsFields}
        richText={richText}
      >
        <CmsSourcesProvider sources={sources} media={media}>
          <SaveErrorBanner />
          <EditorShell mode={mode} requireCommitMessage={requireCommitMessage}>
            {/* Both surfaces stay mounted: switching modes keeps scroll and
                state, and the hidden one renders at low priority. */}
            <React.Activity mode={mode === 'form' ? 'visible' : 'hidden'}>
              <FormSurface>{mode === 'form' ? children : null}</FormSurface>
            </React.Activity>
            <React.Activity mode={mode === 'form' ? 'hidden' : 'visible'}>
              <DeviceCanvas
                components={components}
                resolve={doc.resolve}
                className="relative"
              >
                <CanvasOverlays />
              </DeviceCanvas>
            </React.Activity>
          </EditorShell>
          {mode === 'form' ? null : children}
        </CmsSourcesProvider>
        <ConflictDialog onReloadDocument={retry} />
      </Editor.Root>
    </div>
  );
}

/** `Canvas.Root` in a frame as wide as the shell's device toggle. */
function DeviceCanvas(
  props: Omit<React.ComponentProps<typeof Canvas.Root>, 'surface' | 'frame'>,
) {
  const frame = useDeviceFrame();
  // A device frame narrower than the column sits centered in it.
  return (
    <Canvas.Root
      surface="frame"
      frame={frame}
      {...props}
      style={{
        marginInline: 'auto',
        maxWidth: frame.width === 'full' ? undefined : frame.width,
        ...props.style,
      }}
    />
  );
}

/**
 * Tiptap for `richText` fields, loaded the first time one is edited so it
 * stays out of the page's initial bundle.
 */
const richText = lazyRichTextAdapter(() =>
  import('@createcms/react/editor/richtext').then((m) =>
    m.createTiptapAdapter({ resolveAsset: (id) => assetUrl(id) }),
  ),
);

export { CmsEditor };

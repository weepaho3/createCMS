'use client';

import type { AnyEditorSchema } from '@createcms/react/editor';
import type { CanvasComponents } from '@createcms/react/editor/canvas';
import type {
  CmsDocumentClient,
  CmsDocumentError,
  CmsTemplatesClient,
  UseCmsFieldSourcesClient,
} from '@createcms/react/editor/cms';

import { Editor } from '@createcms/react/editor';
import { Canvas } from '@createcms/react/editor/canvas';
import {
  useCmsDocument,
  useCmsFieldSources,
} from '@createcms/react/editor/cms';
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
import { EditorShell, useEditorChrome } from './editor-shell';

const RESERVED_COLLECTIONS = new Set(['media', 'variables', 'templates']);

export type CmsEditorMode = 'canvas' | 'form';

export type CmsEditorClient = UseCmsFieldSourcesClient & {
  readonly [collection: string]: unknown;
};

export type CmsEditorProps = {
  client: CmsEditorClient;
  templates?: CmsTemplatesClient;
  collection: string;
  rootId: string;
  branchId: string;
  schema: AnyEditorSchema;
  components: CanvasComponents;
  mode?: CmsEditorMode;
  className?: string;
  requireCommitMessage?: boolean;
  children?: React.ReactNode;
};

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

function ConflictDialog({
  open,
  error,
  onReload,
  onForce,
}: {
  open: boolean;
  error: CmsDocumentError | null;
  onReload: () => void;
  onForce: () => void;
}) {
  const forcingRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) forcingRef.current = false;
  }, [open]);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || forcingRef.current) return;
        onReload();
      }}
    >
      <AlertDialogContent data-slot="editor-app-conflict">
        <AlertDialogHeader>
          <AlertDialogTitle>Document conflict</AlertDialogTitle>
          <AlertDialogDescription>
            {error?.message ??
              'This document changed on the server since you loaded it. Reload the latest version or overwrite it.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel type="button">Reload</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            onClick={() => {
              forcingRef.current = true;
              onForce();
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
  schema,
  components,
  mode = 'canvas',
  className,
  requireCommitMessage = false,
  children,
}: CmsEditorProps) {
  const documentClient = readDocumentClient(client, collection);
  const doc = useCmsDocument({
    client: documentClient,
    rootId,
    branchId,
    templates: templates ?? client.templates,
    collection,
  });
  const sources = useCmsFieldSources(client);

  const retry = () => {
    void doc.reload();
  };

  const forceSave = () => {
    void doc.save({ force: true }).catch(() => {
      // useCmsDocument already set status/error; EditorErrorAlert renders it.
    });
  };

  if (!doc.tree) {
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
        defaultValue={doc.tree}
        onSave={doc.save}
        onChange={doc.onChange}
        fields={cmsFields}
      >
        <CmsSourcesProvider sources={sources}>
          <EditorShell mode={mode} requireCommitMessage={requireCommitMessage}>
            {mode === 'form' ? (
              <FormSurface>{children}</FormSurface>
            ) : (
              <Canvas.Root
                components={components}
                resolve={doc.resolve}
                className="relative"
              >
                <CanvasOverlays />
              </Canvas.Root>
            )}
          </EditorShell>
          {mode === 'form' ? null : children}
        </CmsSourcesProvider>
      </Editor.Root>
      <ConflictDialog
        open={doc.status === 'conflict'}
        error={doc.error}
        onReload={retry}
        onForce={forceSave}
      />
    </div>
  );
}

export { CmsEditor };

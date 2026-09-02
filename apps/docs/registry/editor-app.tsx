'use client';

import type { AnyEditorSchema } from '@createcms/react/editor';
import type { CanvasComponents } from '@createcms/react/editor/canvas';
import type {
  CmsDocumentClient,
  CmsDocumentError,
  CmsTemplatesClient,
  UseCmsFieldSourcesClient,
} from '@createcms/react/editor/cms';

import { Editor, useEditor, useSelection } from '@createcms/react/editor';
import { Canvas } from '@createcms/react/editor/canvas';
import {
  useCmsDocument,
  useCmsFieldSources,
} from '@createcms/react/editor/cms';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import {
  BlockToolbar,
  DragHandle,
  DragPreview,
  DropIndicator,
  FieldRing,
  HoverRing,
  InlineText,
  InsertButton,
  Overlay,
  SelectionRing,
} from './editor-canvas';
import { CmsSourcesProvider, cmsFields, Form } from './editor-form';
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
      className={cn('flex min-h-0 flex-1 flex-col gap-3 p-4', className)}
    >
      <Skeleton className="h-12 w-full" />
      <div className="grid min-h-0 flex-1 grid-cols-[16rem_1fr_20rem] gap-3">
        <Skeleton className="min-h-64" />
        <Skeleton className="min-h-64" />
        <Skeleton className="min-h-64" />
      </div>
    </div>
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
        'flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center',
        className,
      )}
    >
      <p className="text-destructive text-sm font-medium">
        {error?.message ?? 'Failed to load the document.'}
      </p>
      {error?.fields?.length ? (
        <ul className="text-muted-foreground max-w-md text-left text-sm">
          {error.fields.map((field) => (
            <li key={`${field.blockId}-${field.key}`}>
              {field.key}: {field.message}
            </li>
          ))}
        </ul>
      ) : null}
      <Button type="button" variant="outline" onClick={onRetry}>
        Retry
      </Button>
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
  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="max-w-sm" data-slot="editor-app-conflict">
        <DialogHeader>
          <DialogTitle>Document conflict</DialogTitle>
          <DialogDescription>
            {error?.message ??
              'This document changed on the server since you loaded it. Reload the latest version or overwrite it.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onReload}>
            Reload
          </Button>
          <Button type="button" onClick={onForce}>
            Overwrite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CanvasOverlays() {
  const selected = useSelection().selected;
  const { setAddOpen } = useEditorChrome();

  return (
    <Overlay>
      <SelectionRing />
      <HoverRing />
      <FieldRing />
      <BlockToolbar side="top" align="start" />
      <InsertButton placement="between" onInsert={() => setAddOpen(true)} />
      <InsertButton placement="container" onInsert={() => setAddOpen(true)} />
      {selected ? <DragHandle blockId={selected} /> : null}
      <DropIndicator />
      <DragPreview />
      <InlineText />
    </Overlay>
  );
}

function FormSurface() {
  const rootId = useEditor((state) => state.rootId);
  return <Form blockId={rootId} />;
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

  if (!doc.tree) {
    if (doc.status === 'error') {
      return (
        <EditorErrorState
          className={className}
          error={doc.error}
          onRetry={() => {
            void doc.reload();
          }}
        />
      );
    }
    return <EditorLoadingSkeleton className={className} />;
  }

  return (
    <div
      data-slot="editor-app"
      data-mode={mode}
      className={cn('relative flex min-h-0 flex-1 flex-col', className)}
    >
      {doc.status === 'error' && doc.error ? (
        <div
          data-slot="editor-app-error-banner"
          className="border-destructive/40 bg-destructive/10 flex items-center justify-between gap-3 border-b px-3 py-2 text-sm"
        >
          <p>{doc.error.message}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void doc.reload();
            }}
          >
            Retry
          </Button>
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
          <EditorShell requireCommitMessage={requireCommitMessage}>
            {mode === 'form' ? (
              <FormSurface />
            ) : (
              <Canvas.Root
                components={components}
                resolve={doc.resolve}
                style={{ position: 'relative' }}
              >
                <CanvasOverlays />
              </Canvas.Root>
            )}
          </EditorShell>
        </CmsSourcesProvider>
      </Editor.Root>
      <ConflictDialog
        open={doc.status === 'conflict'}
        error={doc.error}
        onReload={() => {
          void doc.reload();
        }}
        onForce={() => {
          void doc.save({ force: true }).catch(() => undefined);
        }}
      />
    </div>
  );
}

export { CmsEditor };

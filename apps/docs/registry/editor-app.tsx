// @registry editor-app@0.3.2
'use client';

import type { EditorRootProps, FieldControls } from '@createcms/react/editor';
import type {
  AnyEditorSchema,
  EditorDocument,
  PersistenceAdapter,
  PersistenceOptions,
} from '@createcms/react/editor/core';

import {
  Editor,
  useAdapterDocument,
  useSave,
  useSaveConflict,
} from '@createcms/react/editor';
import { Canvas } from '@createcms/react/editor/canvas';
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
import { useEditorChrome } from './editor-chrome';
import { fieldControls } from './editor-field';
import { FormSurface } from './editor-form';
import { EditorShell, useDeviceFrame } from './editor-shell';

export type EditorAppMode = 'canvas' | 'form';

/** A load or save failure as the alerts show it. */
export type EditorAppError = {
  message: string;
  fields?: readonly { blockId: string; key: string; message: string }[];
};

/** Where the edited document comes from: `useAdapterDocument` or a backend hook. */
export type EditorAppDocument = {
  doc: EditorDocument | null;
  /** Changes with every load: the editor starts over. */
  key: string;
  status: 'loading' | 'idle' | 'error';
  error: EditorAppError | null;
  persistence?: PersistenceOptions;
  reload: () => unknown;
  onChange?: EditorRootProps['onChange'];
};

type CanvasRootProps = React.ComponentProps<typeof Canvas.Root>;

export type EditorAppViewProps = {
  document: EditorAppDocument;
  schema: AnyEditorSchema;
  components: CanvasRootProps['components'];
  /** Display resolvers for the canvas (references, links, variables). */
  resolve?: CanvasRootProps['resolve'];
  /** Field controls per kind (`Editor.Root fields`). Default: `fieldControls`. */
  fields?: FieldControls;
  /** Default: Tiptap, loaded the first time a rich text field is edited. */
  richText?: EditorRootProps['richText'];
  /** Wraps the shell, for providers the field controls read (data sources). */
  renderProviders?: (children: React.ReactNode) => React.ReactNode;
  mode?: EditorAppMode;
  className?: string;
  requireCommitMessage?: boolean;
  children?: React.ReactNode;
};

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
  error: EditorAppError | null;
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
  error: EditorAppError | null;
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
function saveErrorOf(error: Error | null): EditorAppError | null {
  if (!error) return null;
  const details =
    (error as { details?: Record<string, unknown> }).details ?? {};
  const fields = Array.isArray(details.fields)
    ? (details.fields as EditorAppError['fields'])
    : undefined;
  return { message: error.message, fields };
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
    <>
      <Overlay>
        <SelectionRing />
        <HoverRing />
        <FieldRing />
        <InsertButton placement="between" onInsert={() => setAddOpen(true)} />
        <InsertButton placement="container" onInsert={() => setAddOpen(true)} />
        <InlineText />
      </Overlay>
      {/* Chrome that may leave the frame: the toolbar above the first
          block, the indicator and preview at its edges. */}
      <Overlay layer="host">
        <BlockToolbar side="top" align="start" />
        <DropIndicator />
        <DragPreview />
      </Overlay>
    </>
  );
}

/** `Canvas.Root` in a frame as wide as the shell's device toggle. */
function DeviceCanvas(
  props: Omit<React.ComponentProps<typeof Canvas.Root>, 'surface' | 'frame'>,
) {
  const device = useDeviceFrame();
  const [minHeight, setMinHeight] = React.useState(0);
  // The frame fills the visible surface, so a short page leaves no dead
  // band under it and the space below the last block takes drops.
  const fillSurface = React.useCallback((el: HTMLDivElement | null) => {
    const surface = el?.closest<HTMLElement>('[data-slot="editor-surface"]');
    const view = surface?.ownerDocument.defaultView;
    if (!surface || !view) return;
    const measure = () => {
      const style = view.getComputedStyle(surface);
      setMinHeight(
        surface.clientHeight -
          parseFloat(style.paddingTop) -
          parseFloat(style.paddingBottom),
      );
    };
    measure();
    const observer = new view.ResizeObserver(measure);
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);
  const frame = React.useMemo(
    () => ({ ...device, minHeight }),
    [device, minHeight],
  );
  // A device frame narrower than the column sits centered in it.
  return (
    <Canvas.Root
      ref={fillSurface}
      surface="frame"
      frame={frame}
      {...props}
      style={{
        marginInline: 'auto',
        maxWidth: device.width === 'full' ? undefined : device.width,
        ...props.style,
      }}
    />
  );
}

/**
 * Tiptap for `richText` fields, loaded the first time one is edited so it
 * stays out of the page's initial bundle.
 */
const defaultRichText = lazyRichTextAdapter(() =>
  import('@createcms/react/editor/richtext').then((m) =>
    m.createTiptapAdapter(),
  ),
);

/**
 * The full editor (shell, canvas, form, save and conflict handling) over a
 * document from any source: loading skeleton, load error with retry, save
 * error banner and the conflict dialog included.
 */
function EditorAppView({
  document: doc,
  schema,
  components,
  resolve,
  fields = fieldControls,
  richText = defaultRichText,
  renderProviders = (children) => children,
  mode = 'canvas',
  className,
  requireCommitMessage = false,
  children,
}: EditorAppViewProps) {
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
        fields={fields}
        richText={richText}
      >
        {renderProviders(
          <>
            <SaveErrorBanner />
            <EditorShell
              mode={mode}
              requireCommitMessage={requireCommitMessage}
            >
              {/* Both surfaces stay mounted: switching modes keeps scroll and
                  state, and the hidden one renders at low priority. */}
              <React.Activity mode={mode === 'form' ? 'visible' : 'hidden'}>
                <FormSurface>{mode === 'form' ? children : null}</FormSurface>
              </React.Activity>
              <React.Activity mode={mode === 'form' ? 'hidden' : 'visible'}>
                <DeviceCanvas
                  components={components}
                  resolve={resolve}
                  className="relative"
                >
                  <CanvasOverlays />
                </DeviceCanvas>
              </React.Activity>
            </EditorShell>
            {mode === 'form' ? null : children}
          </>,
        )}
        <ConflictDialog onReloadDocument={retry} />
      </Editor.Root>
    </div>
  );
}

export type EditorAppProps = Omit<EditorAppViewProps, 'document'> & {
  /** Loads and saves the document: an `EditorAdapter`, `createMemoryAdapter`, ... */
  adapter: PersistenceAdapter;
  documentId: string;
  /** The loaded document's version, when the adapter knows it (enables conflict checks). */
  baseVersion?: string;
};

/** The editor over an adapter: `useAdapterDocument` plus `EditorAppView`. */
function EditorApp({
  adapter,
  documentId,
  baseVersion,
  ...props
}: EditorAppProps) {
  const loaded = useAdapterDocument({ adapter, id: documentId, baseVersion });
  const document = React.useMemo<EditorAppDocument>(
    () => ({
      doc: loaded.doc,
      key: loaded.key,
      status: loaded.status,
      error: loaded.error,
      persistence: loaded.persistence,
      reload: loaded.reload,
    }),
    [loaded],
  );
  return <EditorAppView document={document} {...props} />;
}

export { DeviceCanvas, EditorApp, EditorAppView };

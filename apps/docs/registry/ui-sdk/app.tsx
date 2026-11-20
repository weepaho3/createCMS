// @registry ui-sdk-editor@0.3.2
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
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@ui-sdk/react/alert-dialog';
import { Button } from '@ui-sdk/react/button';
import * as React from 'react';

import { CanvasChrome } from './canvas';
import { useChrome } from './chrome';
import { fields as defaultFields } from './fields';
import { FormSurface } from './form';
import { EditorShell, useDeviceFrame } from './shell';

export type EditorAppMode = 'canvas' | 'form';

export type EditorAppError = {
  message: string;
  fields?: readonly { blockId: string; key: string; message: string }[];
};

export type EditorAppDocument = {
  doc: EditorDocument | null;
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
  resolve?: CanvasRootProps['resolve'];
  fields?: FieldControls;
  richText?: EditorRootProps['richText'];
  renderProviders?: (children: React.ReactNode) => React.ReactNode;
  mode?: EditorAppMode;
  className?: string;
  requireCommitMessage?: boolean;
  children?: React.ReactNode;
};

function Problem({
  error,
  fallback,
  onRetry,
}: {
  error: EditorAppError | null;
  fallback: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="ed-alert">
      <p className="ed-alert-title">{error?.message ?? fallback}</p>
      {error?.fields?.length ? (
        <ul>
          {error.fields.map((field) => (
            <li key={`${field.blockId}-${field.key}`}>
              {field.key}: {field.message}
            </li>
          ))}
        </ul>
      ) : (
        <p>Retry to load the latest version.</p>
      )}
      <Button className="ed-button" data-variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function saveError(error: Error | null): EditorAppError | null {
  if (!error) return null;
  const details =
    (error as { details?: Record<string, unknown> }).details ?? {};
  return {
    message: error.message,
    fields: Array.isArray(details.fields)
      ? (details.fields as EditorAppError['fields'])
      : undefined,
  };
}

function SaveProblem() {
  const { status, error, save } = useSave();
  if (status !== 'error' || !error) return null;
  return (
    <div className="ed-banner">
      <Problem
        error={saveError(error)}
        fallback="Saving failed."
        onRetry={() => void save()}
      />
    </div>
  );
}

function Conflict({ onReload }: { onReload: () => void }) {
  const conflict = useSaveConflict();
  const { error } = useSave();
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!conflict) setCopied(false);
  }, [conflict]);
  return (
    <AlertDialog
      open={conflict !== null}
      onOpenChange={(open, details) => {
        if (open || details.returnValue === 'overwrite') return;
        if (!conflict?.reload()) onReload();
      }}
    >
      <AlertDialogBackdrop className="ed-backdrop" />
      <AlertDialogContent className="ed-dialog" data-kind="form">
        <div>
          <AlertDialogTitle className="ed-dialog-title">
            Document conflict
          </AlertDialogTitle>
          <AlertDialogDescription className="ed-muted">
            {error?.message ??
              'This document changed on the server since you loaded it. Load the server version, overwrite it with yours, or copy yours first.'}
          </AlertDialogDescription>
        </div>
        <div className="ed-actions">
          <Button
            className="ed-button"
            data-variant="outline"
            onClick={() => conflict?.copyMine().then(() => setCopied(true))}
          >
            {copied ? 'Copied' : 'Copy mine'}
          </Button>
          <AlertDialogClose className="ed-button" data-variant="outline">
            Load server version
          </AlertDialogClose>
          <AlertDialogClose
            value="overwrite"
            className="ed-button"
            data-variant="destructive"
            data-agent-confirm="Replaces the version on the server with yours"
            action={() => conflict?.overwrite()}
          >
            Overwrite
          </AlertDialogClose>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DeviceCanvas(
  props: Omit<CanvasRootProps, 'surface' | 'frame'>,
) {
  const device = useDeviceFrame();
  const [minHeight, setMinHeight] = React.useState(0);
  // The frame fills the surface, so the space below a short page takes drops.
  const fill = React.useCallback((el: HTMLDivElement | null) => {
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
  return (
    <Canvas.Root
      ref={fill}
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

function CanvasSurface(props: Pick<CanvasRootProps, 'components' | 'resolve'>) {
  const { api } = useChrome();
  return (
    <DeviceCanvas {...props} className="ed-canvas">
      <CanvasChrome onInsert={() => api.addBlock()} />
    </DeviceCanvas>
  );
}

const defaultRichText = lazyRichTextAdapter(() =>
  import('@createcms/react/editor/richtext').then((m) =>
    m.createTiptapAdapter(),
  ),
);

export function EditorAppView({
  document: doc,
  schema,
  components,
  resolve,
  fields = defaultFields,
  richText = defaultRichText,
  renderProviders = (children) => children,
  mode = 'canvas',
  className,
  requireCommitMessage = false,
  children,
}: EditorAppViewProps) {
  const retry = () => void doc.reload();
  if (!doc.doc) {
    return doc.status === 'error' ? (
      <div
        className={['ed-app', 'ed-center-state', className]
          .filter(Boolean)
          .join(' ')}
      >
        <Problem
          error={doc.error}
          fallback="Failed to load the document."
          onRetry={retry}
        />
      </div>
    ) : (
      <div
        role="status"
        aria-busy="true"
        className={['ed-app', 'ed-loading', className]
          .filter(Boolean)
          .join(' ')}
      >
        <span className="ed-sr">Loading editor</span>
      </div>
    );
  }
  return (
    <div
      data-mode={mode}
      className={['ed-app', className].filter(Boolean).join(' ')}
    >
      {doc.status === 'error' && doc.error ? (
        <div className="ed-banner">
          <Problem
            error={doc.error}
            fallback="Failed to load the document."
            onRetry={retry}
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
            <SaveProblem />
            <EditorShell
              mode={mode}
              requireCommitMessage={requireCommitMessage}
            >
              {/* Both surfaces stay mounted: switching keeps scroll and state. */}
              <React.Activity mode={mode === 'form' ? 'visible' : 'hidden'}>
                <FormSurface>{mode === 'form' ? children : null}</FormSurface>
              </React.Activity>
              <React.Activity mode={mode === 'form' ? 'hidden' : 'visible'}>
                <CanvasSurface components={components} resolve={resolve} />
              </React.Activity>
            </EditorShell>
            {mode === 'form' ? null : children}
          </>,
        )}
        <Conflict onReload={retry} />
      </Editor.Root>
    </div>
  );
}

export type EditorAppProps = Omit<EditorAppViewProps, 'document'> & {
  adapter: PersistenceAdapter;
  documentId: string;
  baseVersion?: string;
};

export function EditorApp({
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

import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type { MediaMessagesContextValue } from './context';
import type { MediaUploadEntry } from './types';

import { mergeProps, useRender } from '../use-render';
import { useMediaMessages, useMediaUploadsContext } from './context';
import { mediaErrorMessage } from './messages';

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

function isTerminal(status: MediaUploadEntry['status']): boolean {
  return status === 'success' || status === 'error' || status === 'aborted';
}

function announcement(entry: MediaUploadEntry): string {
  switch (entry.status) {
    case 'success':
      return `${entry.name} uploaded`;
    case 'error':
      return `${entry.name} failed${entry.error ? `: ${entry.error.message}` : ''}`;
    case 'aborted':
      return `${entry.name} cancelled`;
    case 'pending':
    case 'uploading':
      return '';
  }
}

// --- Media.UploadList -----------------------------------------------------------

type UploadListState = { empty: boolean };

export type MediaUploadListProps = Omit<
  UseRenderComponentProps<'ul', UploadListState>,
  'children'
> & {
  children: (entry: MediaUploadEntry) => React.ReactNode;
};

/**
 * The upload ledger of `Media.Root`'s client as a `ul`, plus a visually
 * hidden `role="log"` that announces each entry once when it reaches
 * `success`, `error` or `aborted`.
 */
export function MediaUploadList(props: MediaUploadListProps) {
  const { children, render, ...rest } = props;
  const { files } = useMediaUploadsContext('Media.UploadList');
  const announced = React.useRef(new Set<string>());
  const [log, setLog] = React.useState<{ id: string; text: string }[]>([]);

  React.useEffect(() => {
    const fresh = files.filter(
      (entry) => isTerminal(entry.status) && !announced.current.has(entry.id),
    );
    if (fresh.length === 0) return;
    for (const entry of fresh) announced.current.add(entry.id);
    setLog((prev) => [
      ...prev,
      ...fresh.map((entry) => ({ id: entry.id, text: announcement(entry) })),
    ]);
  }, [files]);

  const element = useRender({
    defaultTagName: 'ul',
    render,
    state: { empty: files.length === 0 } satisfies UploadListState,
    props: mergeProps<'ul'>(rest, {
      children: files.map((entry) => children(entry)),
    }),
  });

  return (
    <>
      {element}
      <div role="log" aria-live="polite" style={VISUALLY_HIDDEN}>
        {log.map((line) => (
          <div key={line.id}>{line.text}</div>
        ))}
      </div>
    </>
  );
}

// --- Media.UploadItem -----------------------------------------------------------

const UploadItemContext = React.createContext<MediaUploadEntry | null>(null);

type UploadItemState = { status: MediaUploadEntry['status'] };

export type MediaUploadItemProps = UseRenderComponentProps<
  'li',
  UploadItemState
> & {
  entry: MediaUploadEntry;
};

/** One ledger entry as a `li`; provides it to `Media.UploadProgress`. */
export function MediaUploadItem(props: MediaUploadItemProps) {
  const { entry, render, ...rest } = props;
  const element = useRender({
    defaultTagName: 'li',
    render,
    state: { status: entry.status } satisfies UploadItemState,
    props: rest,
  });
  return (
    <UploadItemContext.Provider value={entry}>
      {element}
    </UploadItemContext.Provider>
  );
}

// --- Media.UploadProgress ---------------------------------------------------------

type UploadProgressState = { status: MediaUploadEntry['status'] | 'all' };

export type MediaUploadProgressProps = UseRenderComponentProps<
  'div',
  UploadProgressState
>;

function valueText(
  entry: MediaUploadEntry,
  fraction: number,
  { messages, format }: MediaMessagesContextValue,
): string {
  switch (entry.status) {
    case 'error':
      return messages.upload.failed(
        { reason: mediaErrorMessage(messages, entry.error?.code) },
        format,
      );
    case 'aborted':
      return messages.upload.status.aborted;
    case 'pending':
    case 'uploading':
    case 'success':
      return format.percent(fraction);
  }
}

/**
 * `role="progressbar"` for the enclosing `Media.UploadItem`, or for all
 * uploads (`progress.fraction`, labelled `upload.all`) outside one.
 */
export function MediaUploadProgress(props: MediaUploadProgressProps) {
  const { render, ...rest } = props;
  const uploads = useMediaUploadsContext('Media.UploadProgress');
  const entry = React.useContext(UploadItemContext);
  const catalog = useMediaMessages();
  const fraction = Math.min(
    Math.max(entry ? entry.progress : uploads.progress.fraction, 0),
    1,
  );
  const percent = Math.round(fraction * 100);

  return useRender({
    defaultTagName: 'div',
    render,
    state: {
      status: entry ? entry.status : 'all',
    } satisfies UploadProgressState,
    props: mergeProps<'div'>(
      {
        role: 'progressbar',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': percent,
        'aria-valuetext': entry
          ? valueText(entry, fraction, catalog)
          : catalog.format.percent(fraction),
        'aria-label': entry ? entry.name : catalog.messages.upload.all,
      },
      rest,
    ),
  });
}

// --- Media.UploadAbort / Media.UploadClear ------------------------------------------

export type MediaUploadAbortProps = UseRenderComponentProps<'button'>;

/** A `button` that aborts every in-flight upload; `disabled` while none is. */
export function MediaUploadAbort(props: MediaUploadAbortProps) {
  const { render, ...rest } = props;
  const { isUploading, abort } = useMediaUploadsContext('Media.UploadAbort');
  return useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      { type: 'button', disabled: !isUploading, onClick: () => abort() },
      rest,
    ),
  });
}

export type MediaUploadClearProps = UseRenderComponentProps<'button'>;

/** A `button` that clears the upload ledger. */
export function MediaUploadClear(props: MediaUploadClearProps) {
  const { render, ...rest } = props;
  const { reset } = useMediaUploadsContext('Media.UploadClear');
  return useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      { type: 'button', onClick: () => reset() },
      rest,
    ),
  });
}

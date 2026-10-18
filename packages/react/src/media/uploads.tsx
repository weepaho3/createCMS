import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type { MediaMessagesContextValue } from './context';
import type { MediaUploadEntry } from './core/types';

import { mergeProps, useRender } from '../use-render';
import { useMediaMessages, useMediaUploadsContext } from './context';
import { progressValueNow } from './core/announcer';
import { mediaErrorMessage } from './messages';

// --- Media.UploadList -----------------------------------------------------------

type UploadListState = { empty: boolean };

export type MediaUploadListProps = Omit<
  UseRenderComponentProps<'ul', UploadListState>,
  'children'
> & {
  children: (entry: MediaUploadEntry) => React.ReactNode;
};

/**
 * The upload queue of `Media.Root`'s client as a `ul` (rendition entries
 * are part of their parent upload and not listed). `Media.Root` announces
 * the batch: its start, at most five progress steps and the result.
 */
export function MediaUploadList(props: MediaUploadListProps) {
  const { children, render, ...rest } = props;
  const { files: all } = useMediaUploadsContext('Media.UploadList');
  const files = React.useMemo(
    () => all.filter((entry) => entry.parentId === undefined),
    [all],
  );
  return useRender({
    defaultTagName: 'ul',
    render,
    state: { empty: files.length === 0 } satisfies UploadListState,
    props: mergeProps<'ul'>(rest, {
      children: files.map((entry) => children(entry)),
    }),
  });
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
    case 'paused':
    case 'retrying':
      return messages.upload.status[entry.status];
    case 'queued':
    case 'preparing':
    case 'signing':
    case 'uploading':
    case 'completing':
    case 'success':
      return format.percent(fraction);
  }
}

/**
 * `role="progressbar"` for the enclosing `Media.UploadItem`, or for all
 * uploads (`progress.fraction`, labelled `upload.all`) outside one.
 * `aria-valuenow` moves in 10 percent steps so screen readers are not
 * flooded; `aria-valuetext` carries the exact value.
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
  const percent = progressValueNow(fraction * 100);

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

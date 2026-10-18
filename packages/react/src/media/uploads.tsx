import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type { MediaMessagesContextValue } from './context';
import type { MediaUploadEntry, MediaUploadState } from './core/types';

import { mergeProps, useRender } from '../use-render';
import { useMediaMessages, useMediaUploadsContext } from './context';
import { progressValueNow } from './core/announcer';
import { mediaErrorMessage } from './messages';

const ACTIVE: ReadonlySet<MediaUploadEntry['status']> = new Set([
  'queued',
  'preparing',
  'signing',
  'uploading',
  'completing',
  'retrying',
]);

/** Whether the entry is still on its way (queued, uploading, retrying, ...). */
export function isUploadActive(entry: MediaUploadEntry): boolean {
  return ACTIVE.has(entry.status);
}

/** Whether the entry waits for a duplicate decision (`Upload.Duplicate`). */
export function isUploadDuplicate(entry: MediaUploadEntry): boolean {
  return entry.status === 'paused' && (entry.duplicateOf?.length ?? 0) > 0;
}

// --- Upload.List ----------------------------------------------------------------

type UploadListState = { empty: boolean };

export type UploadListProps = Omit<
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
export function UploadList(props: UploadListProps) {
  const { children, render, ...rest } = props;
  const { files: all } = useMediaUploadsContext('Upload.List');
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

// --- Upload.Item ------------------------------------------------------------------

const UploadItemContext = React.createContext<MediaUploadEntry | null>(null);

type UploadItemState = {
  status: MediaUploadEntry['status'];
  duplicate: boolean;
};

export type UploadItemProps = UseRenderComponentProps<'li', UploadItemState> & {
  entry: MediaUploadEntry;
};

/**
 * One ledger entry as a `li`; the parts inside (`Upload.Progress`,
 * `Upload.Cancel`, `Upload.Retry`, ...) act on it.
 */
export function UploadItem(props: UploadItemProps) {
  const { entry, render, ...rest } = props;
  const element = useRender({
    defaultTagName: 'li',
    render,
    state: {
      status: entry.status,
      duplicate: isUploadDuplicate(entry),
    } satisfies UploadItemState,
    props: rest,
  });
  return (
    <UploadItemContext.Provider value={entry}>
      {element}
    </UploadItemContext.Provider>
  );
}

/** The entry of the enclosing `Upload.Item`, or `null` outside one. */
export function useUploadEntry(): MediaUploadEntry | null {
  return React.useContext(UploadItemContext);
}

// --- Upload.Progress ----------------------------------------------------------------

type UploadProgressState = { status: MediaUploadEntry['status'] | 'all' };

export type UploadProgressProps = UseRenderComponentProps<
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
 * `role="progressbar"` for the enclosing `Upload.Item`, or for all uploads
 * (`progress.fraction`, labelled `upload.all`) outside one. `aria-valuenow`
 * moves in 10 percent steps so screen readers are not flooded;
 * `aria-valuetext` carries the exact value.
 */
export function UploadProgress(props: UploadProgressProps) {
  const { render, ...rest } = props;
  const uploads = useMediaUploadsContext('Upload.Progress');
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

// --- action buttons ------------------------------------------------------------------

type ActionSpec = {
  name: string;
  /** Whether the action applies to the entry (inside `Upload.Item`). */
  applies: (entry: MediaUploadEntry) => boolean;
  /** Whether the action applies to any entry (outside an item). */
  any: (uploads: MediaUploadState) => boolean;
  run: (uploads: MediaUploadState, entry: MediaUploadEntry | null) => void;
  label: (catalog: MediaMessagesContextValue) => string;
};

function useUploadAction(
  spec: ActionSpec,
  props: UseRenderComponentProps<'button'>,
) {
  const { render, ...rest } = props;
  const uploads = useMediaUploadsContext(spec.name);
  const entry = React.useContext(UploadItemContext);
  const catalog = useMediaMessages();
  const enabled = entry ? spec.applies(entry) : spec.any(uploads);
  return useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'button',
        disabled: !enabled,
        'aria-label': entry
          ? `${spec.label(catalog)}: ${entry.name}`
          : undefined,
        children: spec.label(catalog),
        onClick: () => spec.run(uploads, entry),
      },
      rest,
    ),
  });
}

const listed = (uploads: MediaUploadState) =>
  uploads.files.filter((entry) => entry.parentId === undefined);

export type UploadCancelProps = UseRenderComponentProps<'button'>;

/**
 * A `button` that cancels the enclosing entry, or every upload in flight
 * outside an `Upload.Item`; `disabled` when there is nothing to cancel.
 */
export function UploadCancel(props: UploadCancelProps) {
  return useUploadAction(
    {
      name: 'Upload.Cancel',
      applies: (entry) => isUploadActive(entry) || entry.status === 'paused',
      any: (uploads) => uploads.isUploading,
      run: (uploads, entry) => uploads.abort(entry?.id),
      label: ({ messages }) => messages.upload.cancel,
    },
    props,
  );
}

export type UploadRetryProps = UseRenderComponentProps<'button'>;

/** A `button` that retries the enclosing failed or cancelled entry. */
export function UploadRetry(props: UploadRetryProps) {
  return useUploadAction(
    {
      name: 'Upload.Retry',
      applies: (entry) =>
        entry.status === 'error' || entry.status === 'aborted',
      any: (uploads) =>
        listed(uploads).some(
          (entry) => entry.status === 'error' || entry.status === 'aborted',
        ),
      run: (uploads, entry) => uploads.retry(entry?.id),
      label: ({ messages }) => messages.upload.retry,
    },
    props,
  );
}

export type UploadRetryAllProps = UseRenderComponentProps<'button'>;

/** A `button` that retries every failed entry; `disabled` while none failed. */
export function UploadRetryAll(props: UploadRetryAllProps) {
  return useUploadAction(
    {
      name: 'Upload.RetryAll',
      applies: () => false,
      any: (uploads) =>
        listed(uploads).some((entry) => entry.status === 'error'),
      run: (uploads) => uploads.retry(),
      label: ({ messages }) => messages.upload.retryAll,
    },
    props,
  );
}

export type UploadPauseProps = UseRenderComponentProps<'button'>;

/** A `button` that pauses (or, when paused, resumes) the entry or the queue. */
export function UploadPause(props: UploadPauseProps) {
  const entry = React.useContext(UploadItemContext);
  const paused = entry
    ? entry.status === 'paused' && !isUploadDuplicate(entry)
    : false;
  return useUploadAction(
    {
      name: 'Upload.Pause',
      applies: (item) =>
        isUploadActive(item) ||
        (item.status === 'paused' && !isUploadDuplicate(item)),
      any: (uploads) => uploads.isUploading,
      run: (uploads, item) =>
        paused ? uploads.resume(item?.id) : uploads.pause(item?.id),
      label: ({ messages }) =>
        paused ? messages.upload.resume : messages.upload.pause,
    },
    props,
  );
}

export type UploadClearProps = UseRenderComponentProps<'button'>;

/** A `button` that clears the upload ledger. */
export function UploadClear(props: UploadClearProps) {
  return useUploadAction(
    {
      name: 'Upload.Clear',
      applies: () => false,
      any: (uploads) => listed(uploads).length > 0 && !uploads.isUploading,
      run: (uploads) => uploads.reset(),
      label: ({ messages }) => messages.upload.clear,
    },
    props,
  );
}

// --- Upload.Duplicate ------------------------------------------------------------------

export type UploadDuplicateRenderProps = {
  entry: MediaUploadEntry;
  /** The existing assets with the same bytes. */
  existing: { assetId: string; folderId: string | null }[];
  keepExisting: (assetId?: string) => void;
  uploadAnyway: () => void;
};

export type UploadDuplicateProps = {
  children: (props: UploadDuplicateRenderProps) => React.ReactNode;
};

/**
 * Renders `children` for the enclosing entry while it waits for a
 * duplicate decision, and nothing otherwise.
 */
export function UploadDuplicate(props: UploadDuplicateProps) {
  const uploads = useMediaUploadsContext('Upload.Duplicate');
  const entry = React.useContext(UploadItemContext);
  if (!entry || !isUploadDuplicate(entry)) return null;
  const existing = entry.duplicateOf ?? [];
  return props.children({
    entry,
    existing,
    keepExisting: (assetId = existing[0]?.assetId) => {
      if (assetId) {
        uploads.resolveDuplicate(entry.id, { action: 'use-existing', assetId });
      }
    },
    uploadAnyway: () =>
      uploads.resolveDuplicate(entry.id, { action: 'upload-copy' }),
  });
}

// --- useUploadsPending ------------------------------------------------------------------

/**
 * The uploads among `assetIds` still in flight. A form stores the asset id
 * as soon as `entry.assetId` is known and waits for this to be empty before
 * it saves.
 */
export function useUploadsPending(
  assetIds: readonly string[],
): MediaUploadEntry[] {
  const { files } = useMediaUploadsContext('useUploadsPending');
  return React.useMemo(() => {
    const wanted = new Set(assetIds);
    return files.filter(
      (entry) =>
        entry.assetId !== undefined &&
        wanted.has(entry.assetId) &&
        (isUploadActive(entry) || entry.status === 'paused'),
    );
  }, [files, assetIds]);
}

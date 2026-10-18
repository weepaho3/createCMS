import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type {
  DownloadAsset,
  DownloadJob,
  DownloadOptions,
  DownloadState,
} from './core/downloads';
import type { MediaAsset } from './core/types';

import { mergeProps, useRender } from '../use-render';
import { useMediaContext, useMediaMessages } from './context';
import { progressValueNow } from './core/announcer';
import { downloadQueueOf } from './core/bulk';
import { assetName } from './grid';
import { mediaErrorMessage } from './messages';

const EMPTY: DownloadState = { jobs: [] };
const noopSubscribe = () => () => {};

export type MediaDownloads = DownloadState & {
  /** False when the client has no `downloadIntent`; archives are unavailable then. */
  supported: boolean;
  /** Downloads the assets as one archive and resolves with the finished job. */
  download: (
    assets: readonly (MediaAsset | DownloadAsset)[],
    options?: Partial<DownloadOptions>,
  ) => Promise<DownloadJob | null>;
  cancel: (jobId?: string) => void;
  clear: () => void;
};

function toDownloadAsset(asset: MediaAsset | DownloadAsset): DownloadAsset {
  return 'mimeType' in asset
    ? { id: asset.id, name: assetName(asset), size: asset.size }
    : asset;
}

/**
 * The archive downloads of the enclosing `Media.Root` (shared with the bulk
 * `download` action). Announces the start and the result.
 */
export function useDownloads(): MediaDownloads {
  const { store, announce } = useMediaContext('useDownloads');
  const { messages, format } = useMediaMessages();
  const queue = downloadQueueOf(store);
  const state = React.useSyncExternalStore(
    queue ? queue.subscribe : noopSubscribe,
    queue ? queue.getState : () => EMPTY,
    queue ? queue.getState : () => EMPTY,
  );
  return React.useMemo(
    () => ({
      ...state,
      supported: queue !== null,
      download: async (assets, options) => {
        if (!queue) return null;
        announce(messages.download.started({ count: assets.length }, format));
        const job = await queue.download(assets.map(toDownloadAsset), {
          name: 'media',
          ...options,
        });
        if (job.status === 'success') {
          announce(
            messages.download.finished(
              {
                name: job.name,
                skipped: job.items.filter((item) => item.status !== 'success')
                  .length,
              },
              format,
            ),
          );
        } else if (job.status === 'error') {
          announce(
            messages.download.failed(
              { reason: mediaErrorMessage(messages, job.error ?? undefined) },
              format,
            ),
            'assertive',
          );
        }
        return job;
      },
      cancel: (jobId) => queue?.cancel(jobId),
      clear: () => queue?.clear(),
    }),
    [state, queue, announce, messages, format],
  );
}

// --- Download.Button ---------------------------------------------------------------

export type DownloadButtonProps = Omit<
  UseRenderComponentProps<'button'>,
  'onClick'
> & {
  assets: readonly MediaAsset[];
  /** Archive name for several assets (default `media`). */
  name?: string;
};

/**
 * Downloads one asset through the asset endpoint, or several as one ZIP
 * archive streamed in the browser; `disabled` without assets.
 */
export function DownloadButton(props: DownloadButtonProps) {
  const { assets, name, render, ...rest } = props;
  const downloads = useDownloads();
  const { messages } = useMediaMessages();
  return useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'button',
        disabled: assets.length === 0,
        children: messages.download.button,
        onClick: () => {
          if (assets.length === 1 || !downloads.supported) {
            for (const asset of assets) {
              const separator = asset.deliveryUrl.includes('?') ? '&' : '?';
              globalThis.open?.(
                `${asset.deliveryUrl}${separator}download=true`,
              );
            }
            return;
          }
          void downloads.download(assets, name ? { name } : undefined);
        },
      },
      rest,
    ),
  });
}

// --- Download.List / Item / Progress / Cancel -------------------------------------------

export type DownloadListProps = Omit<
  UseRenderComponentProps<'ul', { empty: boolean }>,
  'children'
> & {
  children: (job: DownloadJob) => React.ReactNode;
};

/** The archive jobs as a `ul`. */
export function DownloadList(props: DownloadListProps) {
  const { children, render, ...rest } = props;
  const { jobs } = useDownloads();
  return useRender({
    defaultTagName: 'ul',
    render,
    state: { empty: jobs.length === 0 },
    props: mergeProps<'ul'>(rest, {
      children: jobs.map((job) => children(job)),
    }),
  });
}

const DownloadJobContext = React.createContext<DownloadJob | null>(null);

export type DownloadItemProps = UseRenderComponentProps<
  'li',
  { status: DownloadJob['status'] }
> & { job: DownloadJob };

/** One archive as a `li`; provides it to `Download.Progress` and `Download.Cancel`. */
export function DownloadItem(props: DownloadItemProps) {
  const { job, render, ...rest } = props;
  const element = useRender({
    defaultTagName: 'li',
    render,
    state: { status: job.status },
    props: rest,
  });
  return (
    <DownloadJobContext.Provider value={job}>
      {element}
    </DownloadJobContext.Provider>
  );
}

export type DownloadProgressProps = UseRenderComponentProps<'div'>;

/**
 * `role="progressbar"` of the enclosing `Download.Item`: bytes of the
 * archive, exact because files are stored uncompressed.
 */
export function DownloadProgress(props: DownloadProgressProps) {
  const { render, ...rest } = props;
  const job = React.useContext(DownloadJobContext);
  const { messages, format } = useMediaMessages();
  if (!job)
    throw new Error('Download.Progress must be used within Download.Item.');
  const fraction = job.total > 0 ? Math.min(job.loaded / job.total, 1) : 0;
  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(
      {
        role: 'progressbar',
        'aria-label': job.name,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': progressValueNow(fraction * 100),
        'aria-valuetext':
          job.status === 'downloading'
            ? messages.download.progress(
                { loaded: job.loaded, total: job.total },
                format,
              )
            : messages.download.status[job.status],
      },
      rest,
    ),
  });
}

export type DownloadCancelProps = UseRenderComponentProps<'button'>;

/**
 * Cancels the enclosing job, or every running one outside a
 * `Download.Item`; `disabled` when nothing runs.
 */
export function DownloadCancel(props: DownloadCancelProps) {
  const { render, ...rest } = props;
  const downloads = useDownloads();
  const job = React.useContext(DownloadJobContext);
  const { messages } = useMediaMessages();
  const running = (j: DownloadJob) =>
    j.status === 'pending' || j.status === 'downloading';
  return useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'button',
        disabled: job ? !running(job) : !downloads.jobs.some(running),
        children: messages.download.cancel,
        onClick: () => downloads.cancel(job?.id),
      },
      rest,
    ),
  });
}

import { cleanup, fireEvent, render } from '@testing-library/react';
// @vitest-environment happy-dom
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaUploadState } from './types';

import { MediaRoot } from './components';
import { makeClient, makeEntry, makeUploadState } from './test-fixtures';
import {
  MediaUploadAbort,
  MediaUploadClear,
  MediaUploadItem,
  MediaUploadList,
  MediaUploadProgress,
} from './uploads';

afterEach(cleanup);

function Harness({ client }: { client: ReturnType<typeof makeClient> }) {
  return (
    <MediaRoot client={client}>
      <MediaUploadProgress data-testid="all" />
      <MediaUploadList data-testid="list">
        {(entry) => (
          <MediaUploadItem key={entry.id} entry={entry}>
            {entry.name}
            <MediaUploadProgress />
          </MediaUploadItem>
        )}
      </MediaUploadList>
      <MediaUploadAbort>Abort</MediaUploadAbort>
      <MediaUploadClear>Clear</MediaUploadClear>
    </MediaRoot>
  );
}

function setup(initial: MediaUploadState) {
  let uploadState = initial;
  const client = makeClient({ useUploadAssets: vi.fn(() => uploadState) });
  const view = render(<Harness client={client} />);
  return {
    ...view,
    client,
    update(next: MediaUploadState) {
      uploadState = next;
      view.rerender(<Harness client={client} />);
    },
  };
}

describe('Media.UploadProgress', () => {
  it('exposes progressbar attributes for an uploading entry', () => {
    const entry = makeEntry({
      id: 'up_1',
      name: 'hero.png',
      status: 'uploading',
      loaded: 45,
      total: 100,
      progress: 0.45,
    });
    const { getByRole, getByTestId } = setup(
      makeUploadState({
        isUploading: true,
        files: [entry],
        progress: {
          loaded: 45,
          total: 100,
          fraction: 0.45,
          bytesPerSecond: null,
          eta: null,
        },
      }),
    );
    const item = getByRole('listitem');
    expect(item.getAttribute('data-status')).toBe('uploading');
    const bar = getByRole('progressbar', { name: 'hero.png' });
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('45');
    expect(bar.getAttribute('aria-valuetext')).toBe('45%');
    expect(bar.getAttribute('data-status')).toBe('uploading');
    expect(getByTestId('list').hasAttribute('data-empty')).toBe(false);
  });

  it('reads the aggregate fraction outside an item', () => {
    const { getByTestId, getByRole } = setup(
      makeUploadState({
        progress: {
          loaded: 30,
          total: 100,
          fraction: 0.3,
          bytesPerSecond: null,
          eta: null,
        },
      }),
    );
    const all = getByTestId('all');
    expect(all.getAttribute('role')).toBe('progressbar');
    expect(all.getAttribute('aria-label')).toBe('All uploads');
    expect(all.getAttribute('aria-valuenow')).toBe('30');
    expect(all.getAttribute('data-status')).toBe('all');
    expect(getByRole('list').hasAttribute('data-empty')).toBe(true);
  });

  it('describes failed and cancelled entries in aria-valuetext', () => {
    const { getByRole } = setup(
      makeUploadState({
        files: [
          makeEntry({
            id: 'e',
            name: 'e.png',
            status: 'error',
            error: { code: 'UPLOAD_FAILED', message: 'boom', retryable: false },
          }),
          makeEntry({ id: 'a', name: 'a.png', status: 'aborted' }),
        ],
      }),
    );
    expect(
      getByRole('progressbar', { name: 'e.png' }).getAttribute(
        'aria-valuetext',
      ),
    ).toBe('Failed: The upload failed.');
    expect(
      getByRole('progressbar', { name: 'a.png' }).getAttribute(
        'aria-valuetext',
      ),
    ).toBe('Cancelled');
  });
});

describe('Media.UploadList log', () => {
  it('announces each terminal entry once', () => {
    const uploading = makeEntry({
      id: 'u',
      name: 'u.png',
      status: 'uploading',
    });
    const { getByRole, update } = setup(
      makeUploadState({ isUploading: true, files: [uploading] }),
    );
    const log = getByRole('log');
    expect(log.textContent).toBe('');

    const done = { ...uploading, status: 'success' as const, progress: 1 };
    update(makeUploadState({ files: [done] }));
    expect(log.textContent).toBe('u.png uploaded');

    update(makeUploadState({ files: [{ ...done }] }));
    expect(log.textContent).toBe('u.png uploaded');

    update(
      makeUploadState({
        files: [
          done,
          makeEntry({
            id: 'f',
            name: 'f.png',
            status: 'error',
            error: { code: 'UPLOAD_FAILED', message: 'boom', retryable: false },
          }),
        ],
      }),
    );
    expect(log.textContent).toBe('u.png uploadedf.png failed: boom');
  });
});

describe('Media.UploadAbort / Media.UploadClear', () => {
  it('abort is disabled while idle and calls abort() while uploading', () => {
    const abort = vi.fn();
    const reset = vi.fn();
    const { getByRole, update } = setup(makeUploadState({ abort, reset }));
    const abortButton = getByRole('button', { name: 'Abort' });
    expect(abortButton.hasAttribute('disabled')).toBe(true);

    update(makeUploadState({ isUploading: true, abort, reset }));
    expect(abortButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(abortButton);
    expect(abort).toHaveBeenCalledTimes(1);

    fireEvent.click(getByRole('button', { name: 'Clear' }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

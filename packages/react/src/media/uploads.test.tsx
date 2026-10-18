import { cleanup, fireEvent, render } from '@testing-library/react';
// @vitest-environment happy-dom
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaUploadState } from './types';

import { MediaRoot } from './root';
import { makeClient, makeEntry, makeUploadState } from './test-fixtures';
import {
  UploadCancel,
  UploadClear,
  UploadDuplicate,
  UploadItem,
  UploadList,
  UploadProgress,
  UploadRetry,
  UploadRetryAll,
} from './uploads';

afterEach(cleanup);

function Harness({ client }: { client: ReturnType<typeof makeClient> }) {
  return (
    <MediaRoot client={client}>
      <UploadProgress data-testid="all" />
      <UploadList data-testid="list">
        {(entry) => (
          <UploadItem key={entry.id} entry={entry}>
            {entry.name}
            <UploadProgress />
          </UploadItem>
        )}
      </UploadList>
      <UploadCancel>Abort</UploadCancel>
      <UploadClear>Clear</UploadClear>
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

describe('Upload.Progress', () => {
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
    expect(bar.getAttribute('aria-valuenow')).toBe('40');
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

describe('Media.Root upload announcements', () => {
  it('announces the start, a failed entry and the result of a batch', () => {
    const uploading = makeEntry({
      id: 'u',
      name: 'u.png',
      status: 'uploading',
    });
    const failing = makeEntry({ id: 'f', name: 'f.png', status: 'uploading' });
    const { getByRole, update } = setup(
      makeUploadState({ isUploading: true, files: [uploading, failing] }),
    );
    const status = getByRole('status');
    expect(status.textContent).toBe('2 files are uploading');

    update(
      makeUploadState({
        isUploading: true,
        files: [
          uploading,
          {
            ...failing,
            status: 'error',
            error: { code: 'UPLOAD_FAILED', message: 'boom', retryable: false },
          },
        ],
      }),
    );
    expect(status.textContent).toBe('f.png failed: The upload failed.');

    update(
      makeUploadState({
        files: [
          { ...uploading, status: 'success', progress: 1 },
          {
            ...failing,
            status: 'error',
            error: { code: 'UPLOAD_FAILED', message: 'boom', retryable: false },
          },
        ],
      }),
    );
    expect(status.textContent).toBe('1 of 2 files uploaded, 1 failed');
  });

  it('announces a batch where everything failed assertively', () => {
    const entry = makeEntry({ id: 'x', name: 'x.png', status: 'uploading' });
    const { getByRole, update } = setup(
      makeUploadState({ isUploading: true, files: [entry] }),
    );
    update(
      makeUploadState({
        files: [
          {
            ...entry,
            status: 'error',
            error: { code: 'UPLOAD_FAILED', message: 'x', retryable: false },
          },
        ],
      }),
    );
    expect(getByRole('alert').textContent).toBe(
      '0 of 1 files uploaded, 1 failed',
    );
  });
});

describe('Upload.Cancel / Upload.Clear', () => {
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

    const clear = getByRole('button', { name: 'Clear' });
    expect(clear.hasAttribute('disabled')).toBe(true);
    update(
      makeUploadState({
        files: [makeEntry({ id: 'up_1', status: 'success' })],
        abort,
        reset,
      }),
    );
    fireEvent.click(clear);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('Upload.Retry / Upload.Duplicate', () => {
  function Panel({ client }: { client: ReturnType<typeof makeClient> }) {
    return (
      <MediaRoot client={client}>
        <UploadRetryAll />
        <UploadList>
          {(entry) => (
            <UploadItem key={entry.id} entry={entry}>
              <UploadRetry />
              <UploadCancel />
              <UploadDuplicate>
                {({ uploadAnyway, keepExisting }) => (
                  <>
                    <button type="button" onClick={() => keepExisting()}>
                      existing
                    </button>
                    <button type="button" onClick={uploadAnyway}>
                      copy
                    </button>
                  </>
                )}
              </UploadDuplicate>
            </UploadItem>
          )}
        </UploadList>
      </MediaRoot>
    );
  }

  it('retries failed entries and resolves duplicates', () => {
    const retry = vi.fn();
    const abort = vi.fn();
    const resolveDuplicate = vi.fn();
    const state = makeUploadState({
      retry,
      abort,
      resolveDuplicate,
      files: [
        makeEntry({ id: 'up_1', name: 'a.png', status: 'error' }),
        makeEntry({
          id: 'up_2',
          name: 'b.png',
          status: 'paused',
          duplicateOf: [{ assetId: 'ast_9', folderId: null }],
        }),
      ],
    });
    const client = makeClient({ useUploadAssets: vi.fn(() => state) });
    const { getByRole } = render(<Panel client={client} />);
    fireEvent.click(getByRole('button', { name: 'Retry failed' }));
    expect(retry).toHaveBeenLastCalledWith();
    fireEvent.click(getByRole('button', { name: 'Retry: a.png' }));
    expect(retry).toHaveBeenLastCalledWith('up_1');
    expect(
      getByRole('button', { name: 'Retry: b.png' }).hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.click(getByRole('button', { name: 'Cancel: b.png' }));
    expect(abort).toHaveBeenCalledWith('up_2');
    fireEvent.click(getByRole('button', { name: 'existing' }));
    expect(resolveDuplicate).toHaveBeenCalledWith('up_2', {
      action: 'use-existing',
      assetId: 'ast_9',
    });
    fireEvent.click(getByRole('button', { name: 'copy' }));
    expect(resolveDuplicate).toHaveBeenLastCalledWith('up_2', {
      action: 'upload-copy',
    });
  });
});

describe('Upload.List renditions', () => {
  it('lists rendition entries only through their parent', () => {
    const parent = makeEntry({
      id: 'up_1',
      status: 'completing',
      phase: 'renditions',
    });
    const child = makeEntry({
      id: 'up_2',
      kind: 'rendition',
      parentId: 'up_1',
      variantKey: 'w320.webp',
    });
    const client = makeClient({
      useUploadAssets: vi.fn(() => makeUploadState({ files: [parent, child] })),
    });
    const { getAllByRole } = render(
      <MediaRoot client={client}>
        <UploadList>{(entry) => <li key={entry.id}>{entry.id}</li>}</UploadList>
      </MediaRoot>,
    );
    expect(getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'up_1',
    ]);
  });
});

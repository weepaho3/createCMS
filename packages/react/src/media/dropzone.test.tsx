import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
// @vitest-environment happy-dom
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaDropzoneProps } from './dropzone';
import type { MediaUploadEntry, MediaUploadState } from './types';

import { MediaRoot } from './components';
import { MediaDropzone, acceptsFile } from './dropzone';
import {
  deferred,
  flush,
  makeClient,
  makeEntry,
  makeUploadState,
} from './test-fixtures';

afterEach(cleanup);

function file(name: string, type: string, size = 10): File {
  return new File([new Uint8Array(size)], name, { type });
}

function setup(
  uploadState: MediaUploadState,
  props: Partial<MediaDropzoneProps> = {},
) {
  const client = makeClient({ useUploadAssets: vi.fn(() => uploadState) });
  const view = render(
    <MediaRoot client={client} defaultFolderId="fld_a">
      <MediaDropzone {...props}>
        {(state) => (state.uploading ? 'Uploading' : 'Drop files')}
      </MediaDropzone>
    </MediaRoot>,
  );
  return { ...view, client, button: view.getByRole('button') };
}

describe('acceptsFile', () => {
  it('matches extensions, wildcards and exact types', () => {
    const png = file('a.PNG', 'image/png');
    expect(acceptsFile(undefined, png)).toBe(true);
    expect(acceptsFile('.png', png)).toBe(true);
    expect(acceptsFile('image/*', png)).toBe(true);
    expect(acceptsFile('image/png', png)).toBe(true);
    expect(acceptsFile('image/jpeg, .svg', png)).toBe(false);
  });
});

describe('Media.Dropzone', () => {
  it('rejects a file by accept and never calls upload', async () => {
    const upload = vi.fn(async () => []);
    const onRejected = vi.fn();
    const svg = file('logo.svg', 'image/svg+xml');
    const { button, getByText } = setup(makeUploadState({ upload }), {
      accept: 'image/png',
      onRejected,
    });
    fireEvent.drop(button, { dataTransfer: { files: [svg] } });
    await flush();
    expect(onRejected).toHaveBeenCalledWith(svg, 'type');
    expect(upload).not.toHaveBeenCalled();
    expect(getByText('1 rejected: unsupported type')).toBeTruthy();
    expect(button.getAttribute('aria-describedby')).toBe(
      getByText('1 rejected: unsupported type').id,
    );
  });

  it('truncates to maxFiles and reports the rest as count', async () => {
    const upload = vi.fn(
      async (files: File[], _options?: { folderId?: string }) =>
        files.map((f, i) =>
          makeEntry({
            id: `up_${i}`,
            name: f.name,
            status: 'success',
            result: { id: `ast_${i}`, slug: f.name, objectKey: f.name },
          }),
        ),
    );
    const onRejected = vi.fn();
    const onUploaded = vi.fn();
    const files = [
      file('a.png', 'image/png'),
      file('b.png', 'image/png'),
      file('c.png', 'image/png'),
    ];
    const { button } = setup(makeUploadState({ upload }), {
      maxFiles: 2,
      onRejected,
      onUploaded,
    });
    fireEvent.drop(button, { dataTransfer: { files } });
    await flush();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]?.[0]).toEqual([files[0], files[1]]);
    expect(upload.mock.calls[0]?.[1]).toEqual({ folderId: 'fld_a' });
    expect(onRejected).toHaveBeenCalledWith(files[2], 'count');
    expect(onUploaded).toHaveBeenCalledWith([
      { id: 'ast_0', slug: 'a.png', objectKey: 'a.png' },
      { id: 'ast_1', slug: 'b.png', objectKey: 'b.png' },
    ]);
  });

  it('rejects files over maxSize', async () => {
    const upload = vi.fn(async () => []);
    const onRejected = vi.fn();
    const big = file('big.png', 'image/png', 2048);
    const { button } = setup(makeUploadState({ upload }), {
      maxSize: 1024,
      onRejected,
    });
    fireEvent.drop(button, { dataTransfer: { files: [big] } });
    await flush();
    expect(onRejected).toHaveBeenCalledWith(big, 'size');
    expect(upload).not.toHaveBeenCalled();
  });

  it('is aria-disabled, not disabled, while uploading and ignores drops', async () => {
    const upload = vi.fn(async () => []);
    const { button } = setup(makeUploadState({ isUploading: true, upload }));
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.hasAttribute('data-uploading')).toBe(true);
    expect(button.hasAttribute('data-disabled')).toBe(true);
    expect(button.textContent).toBe('Uploading');
    fireEvent.drop(button, {
      dataTransfer: { files: [file('a.png', 'image/png')] },
    });
    await flush();
    expect(upload).not.toHaveBeenCalled();
  });

  it('keeps data-drag-active while crossing children', () => {
    const { button } = setup(makeUploadState());
    fireEvent.dragEnter(button);
    expect(button.hasAttribute('data-drag-active')).toBe(true);
    fireEvent.dragEnter(button);
    fireEvent.dragLeave(button);
    expect(button.hasAttribute('data-drag-active')).toBe(true);
    fireEvent.dragLeave(button);
    expect(button.hasAttribute('data-drag-active')).toBe(false);
  });

  it('onUploaded receives only the entries of its own call', async () => {
    const older = makeEntry({
      id: 'old',
      name: 'old.png',
      status: 'success',
      result: { id: 'ast_old', slug: 'old', objectKey: 'old.png' },
    });
    const call = deferred<MediaUploadEntry[]>();
    const upload = vi.fn(() => call.promise);
    const onUploaded = vi.fn();
    const { button } = setup(makeUploadState({ files: [older], upload }), {
      onUploaded,
    });
    fireEvent.drop(button, {
      dataTransfer: {
        files: [file('new.png', 'image/png'), file('bad.png', 'image/png')],
      },
    });
    call.resolve([
      makeEntry({
        id: 'new',
        name: 'new.png',
        status: 'success',
        result: { id: 'ast_new', slug: 'new', objectKey: 'new.png' },
      }),
      makeEntry({
        id: 'bad',
        name: 'bad.png',
        status: 'error',
        error: { code: 'UPLOAD_FAILED', message: 'boom' },
      }),
    ]);
    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
    expect(onUploaded).toHaveBeenCalledWith([
      { id: 'ast_new', slug: 'new', objectKey: 'new.png' },
    ]);
  });

  it('re-announces an identical summary on a later attempt', async () => {
    const upload = vi.fn(async () => []);
    const svg = file('logo.svg', 'image/svg+xml');
    const { button, getByText } = setup(makeUploadState({ upload }), {
      accept: 'image/png',
    });
    fireEvent.drop(button, { dataTransfer: { files: [svg] } });
    await flush();
    const first = getByText('1 rejected: unsupported type');
    fireEvent.drop(button, { dataTransfer: { files: [svg] } });
    await flush();
    const second = getByText('1 rejected: unsupported type');
    expect(second).not.toBe(first);
  });

  it('click opens the hidden file input', () => {
    const { button, container } = setup(makeUploadState());
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    fireEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
    expect(input.multiple).toBe(true);
  });
});

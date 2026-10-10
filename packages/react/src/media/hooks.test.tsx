import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from '@testing-library/react';
// @vitest-environment happy-dom
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaRootProps } from './components';
import type { MediaUploadState } from './types';

import { MediaRoot } from './components';
import {
  useMediaAsset,
  useMediaLibrary,
  useMediaSelection,
  useMediaUploads,
} from './hooks';
import {
  flush,
  makeAssets,
  makeClient,
  makeUploadState,
} from './test-fixtures';

afterEach(cleanup);

function makeWrapper(
  client = makeClient(),
  overrides: Partial<MediaRootProps> = {},
) {
  return ({ children }: { children: React.ReactNode }) => (
    <MediaRoot client={client} {...overrides}>
      {children}
    </MediaRoot>
  );
}

describe('useMediaLibrary', () => {
  it('lists folders and assets on mount', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useMediaLibrary(), {
      wrapper: makeWrapper(client),
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(client.listFolders).toHaveBeenCalledTimes(1);
    expect(client.listAssets).toHaveBeenCalledTimes(1);
    expect(result.current.assets.map((a) => a.id)).toEqual(['ast_1']);
    expect(typeof result.current.navigate).toBe('function');
  });

  it('throws outside Media.Root', () => {
    expect(() => renderHook(() => useMediaLibrary())).toThrow(
      'useMediaLibrary must be used within a Media.Root component.',
    );
  });

  it('does not expose dispose', async () => {
    const { result } = renderHook(() => useMediaLibrary(), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect('dispose' in result.current).toBe(false);
    expect(typeof result.current.clearMutationError).toBe('function');
  });

  it('disposes the store on unmount', async () => {
    const client = makeClient();
    const { result, unmount } = renderHook(() => useMediaLibrary(), {
      wrapper: makeWrapper(client),
    });
    await waitFor(() => expect(result.current.status).toBe('idle'));
    const pending = result.current.load();
    unmount();
    await pending;
    expect(client.listAssets).toHaveBeenCalledTimes(2);
  });
});

describe('useMediaSelection', () => {
  it('toggles in multiple mode', async () => {
    const client = makeClient({
      listAssets: vi.fn(async () => ({
        assets: makeAssets(3),
        total: 3,
        hasMore: false,
        nextCursor: null,
      })),
    });
    const { result } = renderHook(() => useMediaSelection(), {
      wrapper: makeWrapper(client, { selection: 'multiple' }),
    });
    expect(result.current.mode).toBe('multiple');
    await flush();
    act(() => result.current.toggle('ast_1'));
    act(() => result.current.toggle('ast_2'));
    expect(result.current.selected).toEqual(['ast_1', 'ast_2']);
    act(() => result.current.toggle('ast_1'));
    expect(result.current.selected).toEqual(['ast_2']);
    act(() => result.current.clear());
    expect(result.current.selected).toEqual([]);
  });

  it('fires onSelectionChange once per change', async () => {
    const onSelectionChange = vi.fn();
    const { result } = renderHook(() => useMediaSelection(), {
      wrapper: makeWrapper(makeClient(), {
        selection: 'single',
        onSelectionChange,
      }),
    });
    await flush();
    act(() => result.current.select('ast_1'));
    act(() => result.current.select('ast_1'));
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenLastCalledWith(['ast_1']);
    act(() => result.current.clear());
    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });
});

describe('useMediaAsset', () => {
  it('returns the listed asset or null', async () => {
    const { result } = renderHook(
      () => [useMediaAsset('ast_1'), useMediaAsset('missing')] as const,
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current[0]?.id).toBe('ast_1'));
    expect(result.current[1]).toBeNull();
  });
});

describe('uploads', () => {
  function Harness({
    client,
    children,
  }: {
    client: ReturnType<typeof makeClient>;
    children: React.ReactNode;
  }) {
    return <MediaRoot client={client}>{children}</MediaRoot>;
  }

  it('re-lists after the upload state flips isUploading true → false', async () => {
    let uploadState: MediaUploadState = makeUploadState();
    const client = makeClient({ useUploadAssets: vi.fn(() => uploadState) });
    const { rerender } = render(<Harness client={client}>x</Harness>);
    await waitFor(() => expect(client.listAssets).toHaveBeenCalledTimes(1));

    uploadState = makeUploadState({ isUploading: true });
    rerender(<Harness client={client}>x</Harness>);
    await flush();
    expect(client.listAssets).toHaveBeenCalledTimes(1);

    uploadState = makeUploadState({ isUploading: false });
    rerender(<Harness client={client}>x</Harness>);
    await waitFor(() => expect(client.listAssets).toHaveBeenCalledTimes(2));
  });

  it('a library-only consumer does not re-render on upload progress ticks', async () => {
    let uploadState: MediaUploadState = makeUploadState({
      isUploading: true,
    });
    const client = makeClient({ useUploadAssets: vi.fn(() => uploadState) });
    const libraryRenders = vi.fn();
    const uploadRenders = vi.fn();

    function LibraryOnly() {
      useMediaLibrary();
      libraryRenders();
      return null;
    }
    function UploadsOnly() {
      const { progress } = useMediaUploads();
      uploadRenders(progress.fraction);
      return null;
    }
    const children = (
      <>
        <LibraryOnly />
        <UploadsOnly />
      </>
    );

    const { rerender } = render(<Harness client={client}>{children}</Harness>);
    await waitFor(() => expect(client.listAssets).toHaveBeenCalledTimes(1));
    await flush();
    const before = libraryRenders.mock.calls.length;

    uploadState = makeUploadState({
      isUploading: true,
      progress: { loaded: 50, total: 100, fraction: 0.5 },
    });
    rerender(<Harness client={client}>{children}</Harness>);
    await flush();

    expect(libraryRenders).toHaveBeenCalledTimes(before);
    expect(uploadRenders).toHaveBeenLastCalledWith(0.5);
  });
});

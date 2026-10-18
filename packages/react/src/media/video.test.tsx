import { cleanup, render } from '@testing-library/react';
// @vitest-environment happy-dom
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MediaVideo, videoSource } from './video';

afterEach(cleanup);

const stream = {
  provider: 'mux',
  providerAssetId: 'mux_1',
  playbackId: 'play1',
  state: 'ready' as const,
  playbackUrl: 'https://stream.mux.com/play1.m3u8',
  posterUrl: 'https://image.mux.com/play1/thumbnail.jpg',
  sourceKey: 'pub/ast_1/talk.mp4',
};
const asset = {
  id: 'ast_1',
  deliveryUrl: '/api/cms/media/asset/ast_1',
  mimeType: 'video/mp4',
  status: 'public' as const,
  metadata: { stream },
};

describe('Media.Video', () => {
  it('plays the stream of a ready public video and the file otherwise', () => {
    expect(videoSource(asset)).toMatchObject({
      kind: 'stream',
      src: stream.playbackUrl,
      poster: stream.posterUrl,
    });
    for (const other of [
      { ...asset, status: 'private' as const },
      {
        ...asset,
        metadata: { stream: { ...stream, state: 'processing' as const } },
      },
      { ...asset, metadata: {} },
    ]) {
      expect(videoSource(other)).toMatchObject({
        kind: 'file',
        src: asset.deliveryUrl,
      });
    }
  });

  it('hands the stream to attachHls where the browser cannot play HLS', () => {
    const detach = vi.fn();
    const attachHls = vi.fn(() => detach);
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
    const view = render(<MediaVideo asset={asset} attachHls={attachHls} />);
    const video = view.container.querySelector('video')!;
    expect(attachHls).toHaveBeenCalledWith(video, stream.playbackUrl);
    expect(video.getAttribute('src')).toBeNull();
    expect(video.getAttribute('poster')).toBe(stream.posterUrl);
    expect(video.dataset.source).toBe('stream');
    view.unmount();
    expect(detach).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('sets the stream as src where HLS plays natively', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue(
      'maybe',
    );
    const attachHls = vi.fn();
    const view = render(<MediaVideo asset={asset} attachHls={attachHls} />);
    expect(attachHls).not.toHaveBeenCalled();
    expect(view.container.querySelector('video')!.getAttribute('src')).toBe(
      stream.playbackUrl,
    );
    vi.restoreAllMocks();
  });
});

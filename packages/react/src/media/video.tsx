'use client';

import * as React from 'react';

import type { MediaAsset } from './core/types';

export type VideoAsset = Pick<MediaAsset, 'id' | 'deliveryUrl'> &
  Partial<Pick<MediaAsset, 'status' | 'metadata' | 'mimeType'>>;

/** `metadata.stream` of a video the CMS handed to its video provider. */
export type MediaVideoStream = {
  provider: string;
  providerAssetId: string;
  playbackId: string | null;
  state: 'processing' | 'ready' | 'errored';
  playbackUrl: string | null;
  posterUrl: string | null;
  sourceKey: string;
};

export type VideoSource =
  | { kind: 'stream'; src: string; poster: string | null }
  | { kind: 'file'; src: string; poster: null; type: string | null };

/**
 * Where a video plays from: the provider's HLS stream once
 * `metadata.stream` is ready and the asset is public, else the file
 * through the asset endpoint.
 */
export function videoSource(asset: VideoAsset): VideoSource {
  const stream = asset.metadata?.stream as MediaVideoStream | undefined;
  if (
    stream?.state === 'ready' &&
    stream.playbackUrl &&
    asset.status === 'public'
  ) {
    return {
      kind: 'stream',
      src: stream.playbackUrl,
      poster: stream.posterUrl,
    };
  }
  return {
    kind: 'file',
    src: asset.deliveryUrl,
    poster: null,
    type: asset.mimeType ?? null,
  };
}

export type MediaVideoProps = Omit<
  React.VideoHTMLAttributes<HTMLVideoElement>,
  'src'
> & {
  asset: VideoAsset;
  /**
   * Plays an HLS stream where the browser cannot (everything but Safari),
   * e.g. with hls.js: `(video, url) => { const hls = new Hls(); hls.loadSource(url); hls.attachMedia(video); return () => hls.destroy(); }`.
   * Without it the stream URL is set as `src`.
   */
  attachHls?: (video: HTMLVideoElement, url: string) => (() => void) | void;
};

/**
 * A `video` for an asset: the provider's stream (with its poster) for long
 * videos handed to `media.video.provider`, else the file. `data-source` is
 * `stream` or `file`.
 */
export function MediaVideo(props: MediaVideoProps) {
  const {
    asset,
    attachHls,
    poster,
    controls = true,
    preload = 'metadata',
    ...rest
  } = props;
  const source = videoSource(asset);
  const ref = React.useRef<HTMLVideoElement>(null);
  const [hlsAttached, setHlsAttached] = React.useState(false);

  React.useEffect(() => {
    const video = ref.current;
    if (!video || source.kind !== 'stream' || !attachHls) return;
    if (video.canPlayType('application/vnd.apple.mpegurl')) return;
    setHlsAttached(true);
    const detach = attachHls(video, source.src);
    return () => {
      setHlsAttached(false);
      detach?.();
    };
  }, [attachHls, source.kind, source.src]);

  return (
    <video
      ref={ref}
      {...rest}
      controls={controls}
      preload={preload}
      poster={poster ?? source.poster ?? undefined}
      src={hlsAttached ? undefined : source.src}
      data-source={source.kind}
    />
  );
}

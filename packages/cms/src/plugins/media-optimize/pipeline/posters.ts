import type { AssetMetadata } from '../../../core/types/asset-metadata';
import type { PipelineEnv, Rendition } from './process';

import { formatVariantKey } from '../../../core/media/variant-key';
import { heightFor } from './policy';

/** Width of the poster renditions of PDFs, videos and animated images. */
export const POSTER_WIDTH = 640;

/**
 * The parts of pdf.js (`pdfjs-dist`) the PDF poster needs. Configure its
 * worker (`GlobalWorkerOptions.workerSrc`) in the loader.
 */
export type PdfModule = {
  getDocument(source: { data: ArrayBuffer }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getViewport(params: { scale: number }): {
          width: number;
          height: number;
        };
        render(params: {
          canvasContext: CanvasRenderingContext2D;
          viewport: { width: number; height: number };
        }): { promise: Promise<void> };
      }>;
      destroy?: () => Promise<void>;
    }>;
  };
};

export type PosterOutput = {
  renditions: Rendition[];
  media: NonNullable<AssetMetadata['media']>;
  warnings: { code: 'rendition_failed'; message: string }[];
};

/**
 * `channel` reduced to `points` peak values (the maximum absolute sample of
 * each window), rounded to three decimals.
 */
export function downsamplePeaks(
  channel: Float32Array,
  points: number,
): number[] {
  const count = Math.max(1, Math.min(points, channel.length));
  const window = channel.length / count;
  const peaks: number[] = [];
  for (let i = 0; i < count; i++) {
    let peak = 0;
    const end = Math.min(channel.length, Math.floor((i + 1) * window));
    for (let j = Math.floor(i * window); j < end; j++) {
      const value = Math.abs(channel[j]);
      if (value > peak) peak = value;
    }
    peaks.push(Math.round(Math.min(1, peak) * 1000) / 1000);
  }
  return peaks;
}

async function posterFromCanvas(
  canvas: HTMLCanvasElement,
  env: PipelineEnv,
  quality: number,
): Promise<Rendition> {
  const image = await env.decode(
    await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas produced no poster'));
        }
      }, 'image/png');
    }),
    'image/png',
  );
  try {
    const width = Math.min(POSTER_WIDTH, image.width);
    const height = heightFor(width, image.width, image.height);
    const blob = await env.encode(image, {
      width,
      height,
      format: 'webp',
      quality,
    });
    return {
      variantKey: formatVariantKey({ kind: 'poster', width, format: 'webp' }),
      blob,
      width,
      height,
    };
  } finally {
    image.close();
  }
}

/** Page 1 of a PDF as a poster, plus its page count. */
async function pdfPoster(
  file: File,
  pdf: () => Promise<PdfModule>,
  env: PipelineEnv,
  quality: number,
): Promise<PosterOutput> {
  const lib = await pdf();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: POSTER_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No 2d context');
    await page.render({ canvasContext: context, viewport }).promise;
    const rendition = await posterFromCanvas(canvas, env, quality);
    canvas.width = 0;
    return {
      renditions: [rendition],
      media: { pageCount: doc.numPages },
      warnings: [],
    };
  } finally {
    await doc.destroy?.();
  }
}

function once<K extends keyof HTMLMediaElementEventMap>(
  element: HTMLMediaElement,
  type: K,
): Promise<void> {
  return new Promise((resolve, reject) => {
    element.addEventListener(type, () => resolve(), { once: true });
    element.addEventListener(
      'error',
      () => reject(new Error(`Cannot load media for ${type}`)),
      {
        once: true,
      },
    );
  });
}

/** A frame of a video as a poster, plus duration and size. */
async function videoPoster(
  file: File,
  env: PipelineEnv,
  quality: number,
): Promise<PosterOutput> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  try {
    video.src = url;
    await once(video, 'loadeddata');
    const media: PosterOutput['media'] = {};
    if (Number.isFinite(video.duration)) {
      media.durationMs = Math.round(video.duration * 1000);
    }
    video.currentTime = Math.min(0.5, (video.duration || 1) / 10);
    await once(video, 'seeked');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    const rendition = await posterFromCanvas(canvas, env, quality);
    canvas.width = 0;
    return { renditions: [rendition], media, warnings: [] };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Duration and waveform peaks of an audio file. */
async function audioPeaks(file: File): Promise<PosterOutput> {
  const Context = globalThis.OfflineAudioContext ?? globalThis.AudioContext;
  const context = new Context(1, 1, 44_100);
  const buffer = await context.decodeAudioData(await file.arrayBuffer());
  return {
    renditions: [],
    media: {
      durationMs: Math.round(buffer.duration * 1000),
      peaks: downsamplePeaks(buffer.getChannelData(0), 1000),
    },
    warnings: [],
  };
}

/**
 * Posters and media facts for files the raster pipeline skips: page 1 of a
 * PDF (with `pdf`), a video frame, audio peaks. Runs in the page (it needs
 * the media elements). Never rejects: a failure is a warning.
 */
export async function describeMedia(
  file: File,
  type: string,
  options: {
    env: PipelineEnv;
    pdf?: () => Promise<PdfModule>;
    quality: number;
  },
): Promise<PosterOutput | null> {
  try {
    if (type === 'application/pdf' && options.pdf) {
      return await pdfPoster(file, options.pdf, options.env, options.quality);
    }
    if (type.startsWith('video/')) {
      return await videoPoster(file, options.env, options.quality);
    }
    if (type.startsWith('audio/')) return await audioPeaks(file);
    return null;
  } catch (err) {
    return {
      renditions: [],
      media: {},
      warnings: [
        {
          code: 'rendition_failed',
          message: `No poster for ${type}: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
}

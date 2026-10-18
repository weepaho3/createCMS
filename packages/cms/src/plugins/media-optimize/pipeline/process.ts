import type {
  AssetMetadata,
  AssetProvenance,
} from '../../../core/types/asset-metadata';
import type { ContainerType } from '../container';
import type { OriginalPolicy } from './policy';

import {
  encodeThumbHash,
  dominantColorOf,
} from '../../../core/media/placeholder';
import {
  PROVENANCE_SCAN_BYTES,
  readProvenance,
} from '../../../core/media/provenance';
import { formatVariantKey } from '../../../core/media/variant-key';
import { provenanceXmp, stripGps, writeXmp } from '../container';
import { isAnimated } from '../sniff';
import { MAX_DECODE_MEGAPIXELS } from './budget';
import { CONTAINER_TYPES, detectType, RASTER_TYPES } from './detect';
import { readExif } from './exif';
import {
  decideOriginal,
  fitLongEdge,
  heightFor,
  renditionWidthsFor,
} from './policy';
import { POSTER_WIDTH } from './posters';

/** Output formats of the pipeline's encoders. */
export type EncodeFormat = 'webp' | 'jpeg' | 'avif' | 'jxl' | 'png';

/** A decoded, upright image held by the environment. */
export type DecodedImage = {
  readonly width: number;
  readonly height: number;
  close(): void;
};

/**
 * The decode and encode primitives the pipeline runs on: OffscreenCanvas and
 * codecs in a browser or worker, fakes in tests.
 */
export type PipelineEnv = {
  /** Decodes `blob` of `type`, applying EXIF orientation. */
  decode(blob: Blob, type: string): Promise<DecodedImage>;
  /** Scales `image` to `width` x `height` and encodes it. */
  encode(
    image: DecodedImage,
    output: {
      width: number;
      height: number;
      format: EncodeFormat;
      quality: number;
    },
  ): Promise<Blob>;
  /** RGBA pixels of `image` scaled to at most `maxEdge` on its longer side. */
  pixels(
    image: DecodedImage,
    maxEdge: number,
  ): Promise<{ data: Uint8ClampedArray; width: number; height: number }>;
};

/** Settings of one run; plain data, so they cross into a worker. */
export type OptimizeSettings = {
  original: OriginalPolicy;
  maxOriginalMegapixels: number;
  maxOriginalBytes: number;
  masterLongEdge: number;
  renditionWidths: number[];
  /** `avif` and `jxl` renditions are produced only up to their max width. */
  renditionFormats: ('webp' | 'avif' | 'jxl')[];
  avifMaxWidth: number;
  jxlMaxWidth: number;
  /** Also produce a JPEG rendition at 1280 px for clients without WebP. */
  legacyJpeg: boolean;
  quality: {
    webp: number;
    jpeg: number;
    avif: number;
    jxl: number;
    master: number;
  };
  keepIfSmallerRatio: number;
  stripGps: boolean;
  keepCopyright: boolean;
  placeholder: boolean;
  provenance: { read: boolean; writeBack: boolean };
};

export const DEFAULT_SETTINGS: OptimizeSettings = {
  original: 'keep',
  maxOriginalMegapixels: 40,
  maxOriginalBytes: 25 * 1024 * 1024,
  masterLongEdge: 4096,
  renditionWidths: [320, 640, 1280, 1920],
  renditionFormats: ['webp'],
  avifMaxWidth: 1280,
  jxlMaxWidth: 1920,
  legacyJpeg: false,
  quality: { webp: 82, jpeg: 78, avif: 62, jxl: 80, master: 90 },
  keepIfSmallerRatio: 0.9,
  stripGps: true,
  keepCopyright: true,
  placeholder: true,
  provenance: { read: true, writeBack: true },
};

/**
 * Why the pipeline fell back or left something out. The original is always
 * uploaded; a warning only says what was skipped.
 */
export type OptimizeWarningCode =
  | 'optimize_unsupported'
  | 'optimize_failed'
  | 'optimize_timeout'
  | 'optimize_too_large'
  | 'optimize_discard_blocked'
  | 'rendition_failed';

export type OptimizeWarning = { code: OptimizeWarningCode; message: string };

export type Rendition = {
  variantKey: string;
  blob: Blob;
  width: number;
  height: number;
};

/** Everything the pipeline produced for one file. */
export type OptimizeOutput = {
  /** The file to upload as the asset: the original (GPS removed) or a master. */
  file: File;
  /** Renditions to upload as variants after the asset exists. */
  renditions: Rendition[];
  /** Untrusted descriptions for `completeUpload` (`hints`). */
  hints: { metadata: AssetMetadata; provenance?: AssetProvenance };
  optimized: boolean;
  bytesBefore: number;
  bytesAfter: number;
  warnings: OptimizeWarning[];
};

const EXTENSION: Readonly<Record<EncodeFormat, string>> = {
  webp: 'webp',
  jpeg: 'jpg',
  avif: 'avif',
  jxl: 'jxl',
  png: 'png',
};

const AI: ReadonlySet<AssetProvenance> = new Set(['ai_generated', 'ai_edited']);

/** Written back when the source named no Digital Source Type (C2PA only). */
const DEFAULT_SOURCE_TYPE: Readonly<Record<string, string>> = {
  ai_generated: 'trainedAlgorithmicMedia',
  ai_edited: 'compositeWithTrainedAlgorithmicMedia',
};

/** Image types uploaded unchanged by design, without a warning. */
const PASS_THROUGH: ReadonlySet<string> = new Set([
  'image/gif',
  'image/svg+xml',
]);

function renamed(name: string, format: EncodeFormat): string {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.${EXTENSION[format]}`;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function bytesOf(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

/**
 * Runs the optimization pipeline on one file. Never rejects: anything that
 * fails leaves the original (GPS removed where possible) plus a warning.
 *
 * 1. Detect the type by magic bytes; read provenance (IPTC, C2PA) and the
 *    EXIF allowlist before anything is re-encoded.
 * 2. Remove GPS losslessly from JPEG, PNG and WebP.
 * 3. Raster types: decode once (upright), compute ThumbHash and colour,
 *    apply the original policy (`keep`, `master`, `discard`), and encode the
 *    renditions of the width ladder below the source width. AI provenance is
 *    written back into every re-encode as XMP.
 * Animated images, SVG and non-images skip step 3.
 */
export async function processFile(
  file: File,
  settings: OptimizeSettings,
  env: PipelineEnv,
): Promise<OptimizeOutput> {
  const warnings: OptimizeWarning[] = [];
  const metadata: AssetMetadata = {};
  const output = (
    upload: File,
    renditions: Rendition[] = [],
    provenance?: AssetProvenance,
  ): OptimizeOutput => ({
    file: upload,
    renditions,
    hints: provenance ? { metadata, provenance } : { metadata },
    optimized: upload !== file || renditions.length > 0,
    bytesBefore: file.size,
    bytesAfter: upload.size,
    warnings,
  });

  let original = file;
  let provenance: AssetProvenance | undefined;
  let type: string;
  let head: Uint8Array;
  try {
    head = await bytesOf(file.slice(0, PROVENANCE_SCAN_BYTES));
    type = detectType(head) ?? file.type;

    if (settings.provenance.read) {
      const reading = readProvenance(head);
      provenance = reading.provenance;
      Object.assign(metadata, reading.metadata);
    }
    if (CONTAINER_TYPES.has(type)) {
      const facts = readExif(head, type as ContainerType);
      if (Object.keys(facts.exif).length > 0) metadata.exif = facts.exif;
    }

    if (settings.stripGps && CONTAINER_TYPES.has(type)) {
      const all = await bytesOf(file);
      const result = stripGps(all, type as ContainerType, {
        keepCopyright: settings.keepCopyright,
      });
      if (result.stripped) {
        original = new File([result.bytes as BlobPart], file.name, {
          type: file.type,
          lastModified: file.lastModified,
        });
        metadata.exif = { ...metadata.exif, gpsStripped: true };
      }
    }
  } catch (err) {
    warnings.push({ code: 'optimize_failed', message: describe(err) });
    return output(file, [], provenance);
  }

  const animated = isAnimated(type, head);
  if (animated) {
    // Uploaded byte-identical; a still of the first frame is the poster.
    metadata.media = { isAnimated: true };
    const renditions: Rendition[] = [];
    try {
      const image = await env.decode(original, type);
      try {
        const width = Math.min(POSTER_WIDTH, image.width);
        const height = heightFor(width, image.width, image.height);
        renditions.push({
          variantKey: formatVariantKey({
            kind: 'poster',
            width,
            format: 'webp',
          }),
          blob: await env.encode(image, {
            width,
            height,
            format: 'webp',
            quality: settings.quality.webp,
          }),
          width,
          height,
        });
      } finally {
        image.close();
      }
    } catch (err) {
      warnings.push({
        code: 'rendition_failed',
        message: `poster: ${describe(err)}`,
      });
    }
    return output(original, renditions, provenance);
  }
  if (!RASTER_TYPES.has(type)) {
    if (type.startsWith('image/') && !PASS_THROUGH.has(type)) {
      warnings.push({
        code: 'optimize_unsupported',
        message: `${type} is uploaded unchanged`,
      });
    }
    return output(original, [], provenance);
  }

  let image: DecodedImage;
  try {
    image = await env.decode(original, type);
  } catch (err) {
    warnings.push({
      code: 'optimize_unsupported',
      message: `${type} could not be decoded here: ${describe(err)}`,
    });
    return output(original, [], provenance);
  }

  try {
    const { width, height } = image;
    if ((width * height) / 1_000_000 > MAX_DECODE_MEGAPIXELS) {
      warnings.push({
        code: 'optimize_too_large',
        message: `${width} x ${height} exceeds ${MAX_DECODE_MEGAPIXELS} megapixels`,
      });
      return output(original, [], provenance);
    }

    if (settings.placeholder) {
      const pixels = await env.pixels(image, 100);
      const thumbhash = encodeThumbHash(
        pixels.data,
        pixels.width,
        pixels.height,
      );
      metadata.placeholder = { thumbhash };
      metadata.dominantColor = dominantColorOf(thumbhash);
    }

    const xmp =
      settings.provenance.writeBack && provenance && AI.has(provenance)
        ? provenanceXmp(
            metadata.iptcDigitalSourceType ?? DEFAULT_SOURCE_TYPE[provenance],
          )
        : null;
    const withXmp = async (blob: Blob, format: EncodeFormat): Promise<Blob> => {
      // No container writer for AVIF and JPEG XL: they keep no XMP.
      if (!xmp || format === 'avif' || format === 'jxl') return blob;
      const written = writeXmp(
        await bytesOf(blob),
        `image/${format}` as ContainerType,
        xmp,
      );
      return written
        ? new Blob([written as BlobPart], { type: blob.type })
        : blob;
    };

    const decision = decideOriginal({
      policy: settings.original,
      width,
      height,
      bytes: file.size,
      provenance: provenance ?? 'unknown',
      limits: settings,
    });
    if (decision.warning) warnings.push(decision.warning);

    if (decision.action !== 'keep') {
      const size = fitLongEdge(width, height, settings.masterLongEdge);
      // A master of a photo stays JPEG; anything that may carry alpha, and
      // the stand-in for a discarded original, is WebP.
      const photo = type === 'image/jpeg' || type === 'image/heic';
      const format: EncodeFormat =
        decision.action === 'master' && photo ? 'jpeg' : 'webp';
      const quality =
        decision.action === 'discard'
          ? settings.quality.webp
          : settings.quality.master;
      const encoded = await withXmp(
        await env.encode(image, { ...size, format, quality }),
        format,
      );
      // A master that needed no downscale must beat the source by the
      // keep-if-smaller ratio; a discarded original is always replaced.
      const downscaled = size.width < width;
      if (
        encoded.type === `image/${format}` &&
        (decision.action === 'discard' ||
          downscaled ||
          encoded.size <= settings.keepIfSmallerRatio * original.size)
      ) {
        original = new File([encoded], renamed(file.name, format), {
          type: encoded.type,
          lastModified: file.lastModified,
        });
      }
    }

    const renditions: Rendition[] = [];
    const jobs: { width: number; format: EncodeFormat; quality: number }[] = [];
    for (const w of renditionWidthsFor(width, settings.renditionWidths)) {
      for (const format of settings.renditionFormats) {
        if (format === 'avif' && w > settings.avifMaxWidth) continue;
        if (format === 'jxl' && w > settings.jxlMaxWidth) continue;
        jobs.push({ width: w, format, quality: settings.quality[format] });
      }
    }
    if (settings.legacyJpeg && width * 0.9 > 1280) {
      jobs.push({
        width: 1280,
        format: 'jpeg',
        quality: settings.quality.jpeg,
      });
    }
    for (const job of jobs) {
      const out = { ...job, height: heightFor(job.width, width, height) };
      try {
        const blob = await withXmp(await env.encode(image, out), job.format);
        if (blob.type !== `image/${job.format}`) {
          warnings.push({
            code: 'rendition_failed',
            message: `Requested image/${job.format} but got ${blob.type || 'an untyped blob'}`,
          });
          continue;
        }
        renditions.push({
          variantKey: formatVariantKey({
            kind: 'image',
            width: out.width,
            format: job.format,
          }),
          blob,
          width: out.width,
          height: out.height,
        });
      } catch (err) {
        warnings.push({
          code: 'rendition_failed',
          message: `w${job.width}.${job.format}: ${describe(err)}`,
        });
      }
    }
    return output(original, renditions, provenance);
  } catch (err) {
    warnings.push({ code: 'optimize_failed', message: describe(err) });
    return output(original, [], provenance);
  } finally {
    image.close();
  }
}

import type {
  AssetMetadata,
  AssetProvenance,
} from '../core/types/asset-metadata';
import type { CMSMediaUploadOptimizeInfo } from './types';

/**
 * Shared-store key the media-optimize plugin publishes its auto-optimizer
 * under. This module holds no canvas or codec code, so the React entry can
 * import it without pulling in the plugin.
 */
export const UPLOAD_OPTIMIZER_KEY = 'media-optimize:uploadOptimizer';

/** A rendition the queue uploads as a variant once the asset exists. */
export type UploadRendition = {
  /** Canonical variant key, e.g. `w640.webp`. */
  variantKey: string;
  blob: Blob;
  width: number;
  height: number;
};

/** Untrusted descriptions sent with `completeUpload` (`hints`). */
export type UploadHints = {
  metadata?: AssetMetadata;
  provenance?: AssetProvenance;
};

/** What the optimizer made of one file. */
export type OptimizedUpload = {
  /** The file to upload as the asset. */
  file: File;
  renditions: UploadRendition[];
  hints?: UploadHints;
  info?: CMSMediaUploadOptimizeInfo;
};

/** Descriptor published on the shared client store. */
export type UploadOptimizer = {
  enabled: boolean;
  process: (file: File) => Promise<OptimizedUpload>;
};

/**
 * Runs the optimizer without ever blocking the upload: a rejection falls
 * back to the original file without renditions. Outside production,
 * optimizer warnings are logged.
 */
export async function runOptimizer(
  optimizer: UploadOptimizer,
  file: File,
): Promise<OptimizedUpload> {
  let output: OptimizedUpload;
  try {
    output = await optimizer.process(file);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[cms] media optimization failed, uploading the original',
        err,
      );
    }
    return { file, renditions: [] };
  }
  if (process.env.NODE_ENV !== 'production') {
    for (const warning of output.info?.warnings ?? []) {
      console.warn(`[cms] ${warning.code}: ${file.name}: ${warning.message}`);
    }
  }
  return output;
}

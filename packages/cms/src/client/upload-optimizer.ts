import { readUploadAnnotation } from './upload-annotations';

/**
 * Shared-store key the media-optimize plugin publishes its auto-optimizer
 * under. This module holds no canvas or codec code, so the React entry can
 * import it without pulling in the plugin.
 */
export const UPLOAD_OPTIMIZER_KEY = 'media-optimize:uploadOptimizer';

/**
 * Descriptor published on the shared client store. `optimize` returns one
 * file per input (the optimized output or the untouched input).
 */
export type UploadOptimizer = {
  enabled: boolean;
  optimize: (files: File[]) => Promise<File[]>;
};

/**
 * Runs the optimizer without ever blocking the upload: a rejection or a
 * result of the wrong length falls back to the original files. Outside
 * production, optimizer warnings are logged.
 */
export async function optimizeOrPassThrough(
  optimizer: UploadOptimizer,
  files: File[],
): Promise<File[]> {
  let output: File[];
  try {
    output = await optimizer.optimize(files);
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[cms] media optimization failed, uploading originals', err);
    }
    return files;
  }
  if (output.length !== files.length) return files;
  if (process.env.NODE_ENV !== 'production') {
    for (const file of output) {
      for (const warning of readUploadAnnotation(file)?.warnings ?? []) {
        console.warn(`[cms] ${warning.code}: ${file.name}: ${warning.message}`);
      }
    }
  }
  return output;
}

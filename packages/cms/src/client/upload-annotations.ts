import type { CMSMediaUploadOptimizeInfo } from './types';

// Keyed by the exact `File` handed to `upload()`, so the optimizer can attach
// its outcome without changing the `upload(files)` signature. Weak, so
// annotations never outlive their file.
const annotations = new WeakMap<File, CMSMediaUploadOptimizeInfo>();

/** Records the optimizer outcome for a file about to be uploaded. */
export function annotateUpload(
  file: File,
  info: CMSMediaUploadOptimizeInfo,
): void {
  annotations.set(file, info);
}

/** The optimizer outcome recorded for `file`, if any. */
export function readUploadAnnotation(
  file: File,
): CMSMediaUploadOptimizeInfo | undefined {
  return annotations.get(file);
}

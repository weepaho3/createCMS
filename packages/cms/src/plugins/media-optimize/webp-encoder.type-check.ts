// Type-only assertion, checked by `check-types` and never executed: the
// documented codec loaders type-check against the real jSquash module.

import type { CodecLoaders } from './pipeline/codecs';

export const codecs: CodecLoaders = {
  webp: () => import('@jsquash/webp/encode'),
};

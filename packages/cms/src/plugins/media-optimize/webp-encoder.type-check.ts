// Type-only assertion, checked by `check-types` and never executed: the
// loader documented for `webpEncoder` type-checks against the real
// `@jsquash/webp/encode` module.

import type { OptimizationConfig } from '../../core/types/s3';

export const config: OptimizationConfig = {
  convert: { format: 'webp' },
  webpEncoder: () => import('@jsquash/webp/encode'),
};

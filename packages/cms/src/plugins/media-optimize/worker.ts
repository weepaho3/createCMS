import type { CodecLoaders } from './pipeline/codecs';
import type { WorkerRequest, WorkerResponse } from './pipeline/host';

import { createBrowserEnv } from './pipeline/codecs';
import { processFile } from './pipeline/process';

export type { WorkerRequest, WorkerResponse } from './pipeline/host';

type WorkerScope = {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<WorkerRequest>) => void,
  ) => void;
  postMessage: (message: WorkerResponse) => void;
};

function isWorkerScope(value: unknown): value is WorkerScope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'postMessage' in value &&
    'addEventListener' in value &&
    !('document' in value)
  );
}

/**
 * Turns the current worker into an optimization worker. Call it in your own
 * worker module, so your bundler resolves the codec imports and emits their
 * WASM files, and hand `mediaOptimizeClient` a factory for that worker:
 *
 * ```ts
 * // optimize.worker.ts
 * import { serveOptimizeWorker } from '@createcms/core/plugins/media-optimize/worker';
 *
 * serveOptimizeWorker({
 *   codecs: { webp: () => import('@jsquash/webp/encode') },
 * });
 *
 * // client setup
 * mediaOptimizeClient({
 *   worker: () =>
 *     new Worker(new URL('./optimize.worker.ts', import.meta.url), { type: 'module' }),
 * });
 * ```
 */
export function serveOptimizeWorker(
  options: { codecs?: CodecLoaders } = {},
): void {
  if (!isWorkerScope(globalThis)) {
    throw new Error('serveOptimizeWorker must run inside a worker');
  }
  const scope = globalThis;
  const env = createBrowserEnv(options.codecs);
  scope.addEventListener('message', (event) => {
    const { id, file, settings } = event.data;
    void processFile(file, settings, env).then((output) => {
      // A worker's postMessage has no target origin.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      scope.postMessage({ id, output });
    });
  });
}

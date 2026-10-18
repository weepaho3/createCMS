import type { CodecLoaders } from './codecs';
import type { OptimizeOutput, OptimizeSettings, PipelineEnv } from './process';

import { readImageDimensions } from '../../../core/media/dimensions';
import { fileTimeoutMs } from './budget';
import { processFile } from './process';

/** A message to the optimization worker. */
export type WorkerRequest = {
  id: number;
  file: File;
  settings: OptimizeSettings;
};

/** The worker's answer to one request. */
export type WorkerResponse = { id: number; output: OptimizeOutput };

export type OptimizeHostOptions = {
  /** Creates one optimization worker (see `serveOptimizeWorker`). Without it, files are optimized in this thread. */
  createWorker?: () => Worker;
  /** Codec loaders for the in-thread pipeline. */
  codecs?: CodecLoaders;
  /** Files optimized at once. */
  concurrency: number;
  /** Per-megapixel time budget. */
  msPerMegapixel: number;
  /** A worker idle this long is terminated. @default 60000 */
  idleMs?: number;
  /** The environment of the in-thread pipeline (tests). */
  env?: () => PipelineEnv;
};

export type OptimizeHost = {
  run(file: File, settings: OptimizeSettings): Promise<OptimizeOutput>;
  dispose(): void;
};

type Slot = {
  worker: Worker;
  busy: boolean;
  pending: Map<number, (output: OptimizeOutput | null) => void>;
};

function fallback(
  file: File,
  code: 'optimize_timeout' | 'optimize_failed',
  message: string,
): OptimizeOutput {
  return {
    file,
    renditions: [],
    hints: { metadata: {} },
    optimized: false,
    bytesBefore: file.size,
    bytesAfter: file.size,
    warnings: [{ code, message }],
  };
}

/**
 * Runs the optimization pipeline for upload: in up to `concurrency` workers
 * when `createWorker` is set, else in this thread. Each file gets the time
 * budget `fileTimeoutMs` from the dimensions in its header (12 MP when they
 * cannot be read). A worker that runs over the budget or crashes is
 * terminated and replaced, and the file is uploaded unchanged with a
 * warning. Workers idle for `idleMs` are terminated. Never rejects.
 */
export function createOptimizeHost(options: OptimizeHostOptions): OptimizeHost {
  const idleMs = options.idleMs ?? 60_000;
  const slots: Slot[] = [];
  const waiting: (() => void)[] = [];
  let sequence = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let running = 0;

  async function budgetFor(file: File, settings: OptimizeSettings) {
    const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
    const size = readImageDimensions(head) ?? { width: 4000, height: 3000 };
    return fileTimeoutMs(size.width, size.height, {
      msPerMegapixel: options.msPerMegapixel,
      // JPEG XL in WebAssembly is about as slow as AVIF.
      avif:
        settings.renditionFormats.includes('avif') ||
        settings.renditionFormats.includes('jxl'),
    });
  }

  function scheduleIdle() {
    clearTimeout(idleTimer);
    if (running > 0) return;
    idleTimer = setTimeout(() => {
      for (const slot of slots.splice(0)) slot.worker.terminate();
    }, idleMs);
  }

  function retire(slot: Slot) {
    slot.worker.terminate();
    const index = slots.indexOf(slot);
    if (index !== -1) slots.splice(index, 1);
    for (const resolve of slot.pending.values()) resolve(null);
    slot.pending.clear();
  }

  function spawn(createWorker: () => Worker): Slot {
    const worker = createWorker();
    const slot: Slot = { worker, busy: false, pending: new Map() };
    worker.addEventListener(
      'message',
      (event: MessageEvent<WorkerResponse>) => {
        const resolve = slot.pending.get(event.data.id);
        slot.pending.delete(event.data.id);
        resolve?.(event.data.output);
      },
    );
    worker.addEventListener('error', () => retire(slot));
    slots.push(slot);
    return slot;
  }

  async function acquire(): Promise<void> {
    if (running < options.concurrency) {
      running++;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
    running++;
  }

  function release() {
    running--;
    waiting.shift()?.();
    scheduleIdle();
  }

  async function inWorker(
    createWorker: () => Worker,
    file: File,
    settings: OptimizeSettings,
    budget: number,
  ): Promise<OptimizeOutput> {
    const slot = slots.find((s) => !s.busy) ?? spawn(createWorker);
    slot.busy = true;
    const id = ++sequence;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const output = await new Promise<OptimizeOutput | null | 'timeout'>(
      (resolve) => {
        slot.pending.set(id, resolve);
        timer = setTimeout(() => resolve('timeout'), budget);
        // A worker's postMessage has no target origin.
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        slot.worker.postMessage({ id, file, settings } satisfies WorkerRequest);
      },
    );
    clearTimeout(timer);
    slot.busy = false;
    if (output === 'timeout') {
      retire(slot);
      return fallback(
        file,
        'optimize_timeout',
        `Optimization ran over ${budget} ms`,
      );
    }
    if (!output) {
      return fallback(
        file,
        'optimize_failed',
        'The optimization worker crashed',
      );
    }
    return output;
  }

  async function inThread(
    file: File,
    settings: OptimizeSettings,
    budget: number,
  ): Promise<OptimizeOutput> {
    const { createBrowserEnv } = await import('./codecs');
    const env = options.env?.() ?? createBrowserEnv(options.codecs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<OptimizeOutput>((resolve) => {
      timer = setTimeout(
        () =>
          resolve(
            fallback(
              file,
              'optimize_timeout',
              `Optimization ran over ${budget} ms`,
            ),
          ),
        budget,
      );
    });
    try {
      return await Promise.race([processFile(file, settings, env), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async run(file, settings) {
      await acquire();
      clearTimeout(idleTimer);
      try {
        const budget = await budgetFor(file, settings);
        return options.createWorker
          ? await inWorker(options.createWorker, file, settings, budget)
          : await inThread(file, settings, budget);
      } catch (err) {
        return fallback(
          file,
          'optimize_failed',
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        release();
      }
    },
    dispose() {
      clearTimeout(idleTimer);
      for (const slot of slots.splice(0)) retire(slot);
    },
  };
}

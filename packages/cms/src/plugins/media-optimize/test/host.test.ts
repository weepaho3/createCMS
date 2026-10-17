import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WorkerRequest, WorkerResponse } from '../pipeline/host';
import type { OptimizeOutput, PipelineEnv } from '../pipeline/process';

import { createOptimizeHost } from '../pipeline/host';
import { DEFAULT_SETTINGS } from '../pipeline/process';

type Mode = 'answer' | 'hang' | 'crash';

/** A Worker stand-in that answers, hangs or crashes on each request. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  mode: Mode = 'answer';
  terminated = false;
  requests: WorkerRequest[] = [];
  private listeners: Record<string, ((event: unknown) => void)[]> = {};

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, fn: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(fn);
  }

  postMessage(request: WorkerRequest) {
    this.requests.push(request);
    if (this.mode === 'hang') return;
    queueMicrotask(() => {
      if (this.mode === 'crash') {
        for (const fn of this.listeners.error ?? []) fn(new Event('error'));
        return;
      }
      const output: OptimizeOutput = {
        file: request.file,
        renditions: [],
        hints: { metadata: { dominantColor: '#000000' } },
        optimized: true,
        bytesBefore: request.file.size,
        bytesAfter: request.file.size,
        warnings: [],
      };
      const response: WorkerResponse = { id: request.id, output };
      for (const fn of this.listeners.message ?? []) fn({ data: response });
    });
  }

  terminate() {
    this.terminated = true;
  }
}

const file = (name = 'a.png') =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, {
    type: 'image/png',
  });

function host(concurrency = 2) {
  return createOptimizeHost({
    createWorker: () => new FakeWorker() as unknown as Worker,
    concurrency,
    msPerMegapixel: 1500,
  });
}

afterEach(() => {
  FakeWorker.instances = [];
  vi.useRealTimers();
});

describe('createOptimizeHost', () => {
  it('runs a file in a worker', async () => {
    const out = await host().run(file(), DEFAULT_SETTINGS);
    expect(out.hints.metadata.dominantColor).toBe('#000000');
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('reuses an idle worker and terminates it after 60 s idle', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = host();
    await h.run(file(), DEFAULT_SETTINGS);
    await h.run(file(), DEFAULT_SETTINGS);
    expect(FakeWorker.instances).toHaveLength(1);
    vi.advanceTimersByTime(59_999);
    expect(FakeWorker.instances[0].terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it('terminates a worker over the time budget and uploads the original', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const h = createOptimizeHost({
      createWorker: () => {
        const worker = new FakeWorker();
        worker.mode = 'hang';
        return worker as unknown as Worker;
      },
      concurrency: 1,
      msPerMegapixel: 1500,
    });
    const input = file();
    const pending = h.run(input, DEFAULT_SETTINGS);
    await vi.advanceTimersByTimeAsync(21_000);
    const out = await pending;
    expect(out.file).toBe(input);
    expect(out.warnings[0].code).toBe('optimize_timeout');
    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  it('replaces a crashed worker', async () => {
    let first = true;
    const h = createOptimizeHost({
      createWorker: () => {
        const worker = new FakeWorker();
        if (first) worker.mode = 'crash';
        first = false;
        return worker as unknown as Worker;
      },
      concurrency: 1,
      msPerMegapixel: 1500,
    });
    const crashed = await h.run(file(), DEFAULT_SETTINGS);
    expect(crashed.warnings[0].code).toBe('optimize_failed');
    const ok = await h.run(file(), DEFAULT_SETTINGS);
    expect(ok.optimized).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it('optimizes at most `concurrency` files at once', async () => {
    const h = createOptimizeHost({
      createWorker: () => {
        const worker = new FakeWorker();
        worker.mode = 'hang';
        return worker as unknown as Worker;
      },
      concurrency: 2,
      msPerMegapixel: 1500,
    });
    void h.run(file('1.png'), DEFAULT_SETTINGS);
    void h.run(file('2.png'), DEFAULT_SETTINGS);
    void h.run(file('3.png'), DEFAULT_SETTINGS);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const sent = FakeWorker.instances.flatMap((w) => w.requests);
    expect(sent.map((r) => r.file.name)).toEqual(['1.png', '2.png']);
    h.dispose();
  });

  it('runs in this thread without a worker factory', async () => {
    const env: PipelineEnv = {
      decode: async () => {
        throw new Error('no decoder');
      },
      encode: async () => new Blob(),
      pixels: async () => ({
        data: new Uint8ClampedArray(4),
        width: 1,
        height: 1,
      }),
    };
    const input = file();
    const out = await createOptimizeHost({
      concurrency: 1,
      msPerMegapixel: 1500,
      env: () => env,
    }).run(input, DEFAULT_SETTINGS);
    expect(out.file).toBe(input);
    expect(out.warnings[0].code).toBe('optimize_unsupported');
  });
});

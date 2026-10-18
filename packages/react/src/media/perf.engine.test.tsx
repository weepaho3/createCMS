import { act, cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaAssetListQuery, MediaUploadState } from './core/types';

import { createMediaStore } from './core/store';
import { Media, Upload } from './index';
import {
  makeAsset,
  makeClient,
  makeEntry,
  makeUploadState,
} from './test-fixtures';

afterEach(cleanup);

const TOTAL = 10_000;
const PAGE = 100;

/** Thresholds are reported as warnings: CI machines vary too much to fail on them. */
function warnAbove(label: string, value: number, limit: number) {
  const line = `[perf] ${label}: ${Math.round(value)} (limit ${limit})`;
  if (value > limit) console.warn(line);
  else console.info(line);
}

function uploadStore() {
  let state: MediaUploadState = makeUploadState();
  const listeners = new Set<() => void>();
  return {
    set(next: MediaUploadState) {
      state = next;
      for (const listener of listeners) listener();
    },
    use: () =>
      React.useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => state,
      ),
  };
}

describe('media grid with 10,000 assets', () => {
  it('does not re-render the grid on upload ticks and virtualizes while scrolling', async () => {
    const uploads = uploadStore();
    const client = makeClient({
      listAssets: vi.fn(async (args?: { query?: MediaAssetListQuery }) => {
        const offset = Number(args?.query?.cursor ?? 0);
        const assets = Array.from(
          { length: Math.min(PAGE, TOTAL - offset) },
          (_, i) =>
            makeAsset({
              id: `a${offset + i}`,
              originalName: `photo-${offset + i}.jpg`,
              width: 1200 + ((offset + i) % 7) * 100,
              height: 900,
            }),
        );
        const next = offset + assets.length;
        return {
          assets,
          total: TOTAL,
          hasMore: next < TOTAL,
          nextCursor: next < TOTAL ? String(next) : null,
        };
      }),
      useUploadAssets: vi.fn(uploads.use),
    });
    const store = createMediaStore({ client, pageSize: PAGE });
    let gridCommits = 0;
    const view = render(
      <Media.Root client={client} store={store}>
        <div
          data-testid="scroller"
          style={{ height: 800, width: 1000, overflow: 'auto' }}
        >
          <React.Profiler id="grid" onRender={() => gridCommits++}>
            <Media.Grid minCell={160} gap={8}>
              {(asset) => (
                <Media.Item key={asset.id} asset={asset}>
                  {asset.originalName}
                </Media.Item>
              )}
            </Media.Grid>
          </React.Profiler>
        </div>
        <Upload.Progress />
      </Media.Root>,
    );
    await act(async () => {
      await store.dispatch({ type: 'init' });
      while (store.getState().collection.cursor !== null) {
        await store.dispatch({ type: 'loadMore' });
      }
    });
    expect(store.getState().collection.ids).toHaveLength(TOTAL);
    await waitFor(() =>
      expect(
        view.container.querySelectorAll('[role="gridcell"]').length,
      ).toBeGreaterThan(0),
    );

    // Upload progress lives in its own context: ticks must not reach the grid.
    const before = gridCommits;
    for (let tick = 1; tick <= 20; tick++) {
      await act(async () => {
        uploads.set(
          makeUploadState({
            isUploading: true,
            files: [
              makeEntry({ id: 'u1', status: 'uploading', progress: tick / 21 }),
            ],
            progress: {
              loaded: tick,
              total: 21,
              fraction: tick / 21,
              bytesPerSecond: null,
              eta: null,
            },
          }),
        );
      });
    }
    expect(gridCommits - before).toBe(0);

    // Scroll top to bottom; only the rows in view stay mounted.
    const scroller = view.getByTestId('scroller');
    const longTasks: number[] = [];
    const supportsLongTasks =
      PerformanceObserver.supportedEntryTypes?.includes('longtask');
    const observer = supportsLongTasks
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        })
      : null;
    observer?.observe({ type: 'longtask', buffered: false });
    const frames: number[] = [];
    let mountedMax = 0;
    const steps = 60;
    for (let step = 1; step <= steps; step++) {
      const started = performance.now();
      scroller.scrollTop = (scroller.scrollHeight * step) / steps;
      scroller.dispatchEvent(new Event('scroll'));
      await new Promise((resolve) =>
        requestAnimationFrame(() => resolve(null)),
      );
      frames.push(performance.now() - started);
      mountedMax = Math.max(
        mountedMax,
        view.container.querySelectorAll('[role="gridcell"]').length,
      );
    }
    observer?.disconnect();

    expect(mountedMax).toBeLessThan(500);
    const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
    warnAbove('mean frame while scrolling (ms)', mean, 50);
    if (supportsLongTasks) {
      const meanLong = longTasks.length
        ? longTasks.reduce((a, b) => a + b, 0) / longTasks.length
        : 0;
      warnAbove('mean long task while scrolling (ms)', meanLong, 50);
    }
  });
});

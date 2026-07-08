import { atom } from 'nanostores';
import { describe, expect, it, vi } from 'vitest';

import type { CMSAtomListener, CMSFetch } from '../types';

import { createDynamicPathProxy } from '../proxy';

// Unit coverage for the browser client's Proxy dispatch layer: property access
// -> `$fetch('/ns/method', { method, ...opts })`, HTTP-method inference from
// body presence, `pathMethods` overrides, and post-mutation atom invalidation.

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('createDynamicPathProxy — dispatch', () => {
  it('dispatches a no-body call as GET', async () => {
    const $fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as CMSFetch;
    const proxy = createDynamicPathProxy({}, $fetch, { '/x/force': 'POST' }, {}, []);

    await proxy.pages.listRoots();

    expect($fetch).toHaveBeenCalledWith('/pages/listRoots', { method: 'GET' });
  });

  it('dispatches a call WITH a body as POST, forwarding the body', async () => {
    const $fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as CMSFetch;
    const proxy = createDynamicPathProxy({}, $fetch, { '/x/force': 'POST' }, {}, []);

    await proxy.pages.createRoot({ body: { a: 1 } });

    expect($fetch).toHaveBeenCalledWith('/pages/createRoot', {
      method: 'POST',
      body: { a: 1 },
    });
  });

  it('honors a pathMethods override, forcing POST on a no-body call', async () => {
    const $fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as CMSFetch;
    const proxy = createDynamicPathProxy({}, $fetch, { '/x/force': 'POST' }, {}, []);

    await proxy.x.force();

    expect($fetch).toHaveBeenCalledWith('/x/force', { method: 'POST' });
  });
});

describe('createDynamicPathProxy — atom invalidation', () => {
  it('flips the matching signal after a non-GET mutation', async () => {
    const $mediaSignal = atom(false);
    const $fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as CMSFetch;
    const listeners: CMSAtomListener[] = [
      { matcher: (p) => p.startsWith('/media/'), signal: '$mediaSignal' },
    ];
    const proxy = createDynamicPathProxy(
      {},
      $fetch,
      {},
      { $mediaSignal },
      listeners,
    );

    await proxy.media.upload({ body: { file: 'x' } });
    await flush();

    expect($mediaSignal.get()).toBe(true);
  });

  it('does NOT flip the signal on a GET read of the same namespace', async () => {
    const $mediaSignal = atom(false);
    const $fetch = vi.fn().mockResolvedValue({ ok: true }) as unknown as CMSFetch;
    const listeners: CMSAtomListener[] = [
      { matcher: (p) => p.startsWith('/media/'), signal: '$mediaSignal' },
    ];
    const proxy = createDynamicPathProxy(
      {},
      $fetch,
      {},
      { $mediaSignal },
      listeners,
    );

    await proxy.media.list();
    await flush();

    expect($mediaSignal.get()).toBe(false);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { server } from 'vitest/browser';

// What a frame's own document still runs under
// `sandbox="allow-same-origin"` without `allow-scripts`, per engine. The
// live canvas frame stays unsandboxed because of the WebKit row.

afterEach(() => {
  for (const frame of document.querySelectorAll('iframe')) frame.remove();
});

async function frameWith(sandbox: string | null): Promise<HTMLIFrameElement> {
  const frame = document.createElement('iframe');
  if (sandbox !== null) frame.setAttribute('sandbox', sandbox);
  frame.srcdoc =
    '<!doctype html><html><head></head><body><div id="t">x</div></body></html>';
  const loaded = new Promise((resolve) => {
    frame.addEventListener('load', resolve, { once: true });
  });
  document.body.append(frame);
  await loaded;
  return frame;
}

const within = <T,>(promise: Promise<T>, ms = 500) =>
  Promise.race([
    promise,
    new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), ms);
    }),
  ]);

async function probe(sandbox: string | null) {
  const frame = await frameWith(sandbox);
  const doc = frame.contentDocument!;
  const view = frame.contentWindow as Window & typeof globalThis;
  const target = doc.getElementById('t')!;
  const raf = await within(
    new Promise((resolve) => view.requestAnimationFrame(() => resolve('ok'))),
  );
  const observers = await within(
    new Promise((resolve) => {
      const resize = new view.ResizeObserver(() => {
        resize.disconnect();
        const mutation = new view.MutationObserver(() => {
          mutation.disconnect();
          resolve('ok');
        });
        mutation.observe(target, { childList: true });
        target.append(doc.createElement('span'));
      });
      resize.observe(target);
    }),
  );
  let listener = 'timeout';
  target.addEventListener('click', () => {
    listener = 'ok';
  });
  target.click();
  return { raf, observers, listener };
}

describe('frame sandbox capabilities', () => {
  it('an unsandboxed frame runs rAF, observers and listeners', async () => {
    expect(await probe(null)).toEqual({
      raf: 'ok',
      observers: 'ok',
      listener: 'ok',
    });
  });

  it('allow-same-origin without allow-scripts: WebKit drops rAF and listeners', async () => {
    const webkit = server.browser === 'webkit';
    expect(await probe('allow-same-origin')).toEqual({
      raf: webkit ? 'timeout' : 'ok',
      observers: 'ok',
      listener: webkit ? 'timeout' : 'ok',
    });
  });
});

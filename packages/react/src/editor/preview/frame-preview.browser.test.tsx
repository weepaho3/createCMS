import { cleanup, render, waitFor } from '@testing-library/react';
import { act, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from 'vitest/browser';

import type { EditorStore } from '../core/store';

import { useEditorContext } from '../context';
import { makeDoc, storeSchema } from '../core/store/fixtures';
import { Editor } from '../index';

afterEach(cleanup);

// WebKit does not run listeners the host page adds inside a frame sandboxed
// without `allow-scripts`: clicks arrive through the host shield there, and
// the frame never takes focus, so keys stay in the host document.
const noFrameListeners = server.browser === 'webkit';

/** Clicks `el` in the frame the way a user would: through the shield when one covers the frame. */
async function clickInFrame(host: HTMLElement, el: Element) {
  const frame = frontFrame(host);
  if (noFrameListeners) {
    await waitFor(() => {
      expect(host.querySelector('[data-editor-frame-shield]')).not.toBeNull();
    });
    const shield = host.querySelector('[data-editor-frame-shield]')!;
    const frameRect = frame.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    shield.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: frameRect.left + rect.left + rect.width / 2,
        clientY: frameRect.top + rect.top + rect.height / 2,
      }),
    );
    return;
  }
  (el as HTMLElement).click();
}

type Probe = { store: EditorStore | null };

function StoreProbe({ probe }: { probe: Probe }) {
  probe.store = useEditorContext('StoreProbe').store;
  return null;
}

const HEADING_HTML =
  '<section data-editor-block="h1">' +
  '<h1 data-editor-field="text">Hello</h1>' +
  '</section>';

const MINIMAL_PDF = '%PDF-1.1\n%%EOF\n';

function framesOf(host: HTMLElement): HTMLIFrameElement[] {
  return [...host.querySelectorAll('iframe')];
}

function frontFrame(host: HTMLElement): HTMLIFrameElement {
  const front = framesOf(host).find((frame) => !frame.hasAttribute('inert'));
  if (!front) throw new Error('no front iframe');
  return front;
}

function frameHtml(frame: HTMLIFrameElement): string {
  const srcDoc = frame.srcdoc || frame.getAttribute('srcdoc') || '';
  const body = frame.contentDocument?.body?.innerHTML ?? '';
  return srcDoc + body;
}

function renderFrame(options: {
  html?: string;
  render?: (
    tree: unknown,
    ctx: { signal: AbortSignal },
  ) => Promise<string | Blob>;
  selectable?: boolean;
  extra?: ReactNode;
}) {
  const probe: Probe = { store: null };
  const compile =
    options.render ?? (async () => options.html ?? '<p>hello</p>');
  const utils = render(
    <Editor.Root schema={storeSchema} defaultValue={makeDoc()}>
      <StoreProbe probe={probe} />
      {options.extra}
      <Editor.FramePreview
        data-testid="fp"
        debounceMs={0}
        selectable={options.selectable}
        style={{ height: 240 }}
        render={compile}
      />
    </Editor.Root>,
  );
  if (!probe.store) throw new Error('store probe did not mount');
  return { ...utils, store: probe.store, host: utils.getByTestId('fp') };
}

describe('Editor.FramePreview in a real browser', () => {
  it('html srcDoc after load, two iframes, no flash of empty front', async () => {
    const { host } = renderFrame({ html: '<p>hello</p>' });
    expect(framesOf(host)).toHaveLength(2);
    expect(framesOf(host).some((frame) => frame.hasAttribute('inert'))).toBe(
      true,
    );
    await waitFor(
      () => {
        expect(frameHtml(frontFrame(host))).toContain('hello');
      },
      { timeout: 5000 },
    );
    expect(framesOf(host)).toHaveLength(2);
    expect(frontFrame(host).hasAttribute('inert')).toBe(false);
  });

  it('sequence race keeps the newer html', async () => {
    let first!: (html: string) => void;
    let calls = 0;
    const { host, store } = renderFrame({
      render: () => {
        calls += 1;
        if (calls === 1) {
          return new Promise<string>((resolve) => {
            first = resolve;
          });
        }
        return Promise.resolve('<p>new</p>');
      },
    });
    await waitFor(() => expect(calls).toBe(1), { timeout: 5000 });
    act(() => {
      store.update('root_1', { title: 'Next' });
    });
    await waitFor(() => expect(calls).toBe(2), { timeout: 5000 });
    await waitFor(
      () => {
        expect(frameHtml(frontFrame(host))).toContain('new');
      },
      { timeout: 5000 },
    );
    first('<p>old</p>');
    await act(async () => {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 50);
      });
    });
    const html = frameHtml(frontFrame(host));
    expect(html).toContain('new');
    expect(html).not.toContain('old');
  });

  it('selectable click writes select and focus', async () => {
    const { host, store } = renderFrame({
      html: HEADING_HTML,
      selectable: true,
    });
    await waitFor(
      () => {
        expect(frontFrame(host).contentDocument).not.toBeNull();
        expect(
          frontFrame(host).contentDocument?.querySelector('h1'),
        ).not.toBeNull();
      },
      { timeout: 5000 },
    );
    const doc = frontFrame(host).contentDocument;
    if (doc === null) {
      throw new Error('contentDocument is null on selectable frame');
    }
    const heading = doc.querySelector('h1');
    if (!heading) throw new Error('missing heading');
    await clickInFrame(host, heading);
    await waitFor(() => {
      const local = {
        selected: store.getSession().selection[0] ?? null,
        focus: store.getSession().focusedField,
        editing: store.getSession().editing,
      };
      expect(local?.selected).toBe('h1');
      expect(local?.focus).toEqual({ blockId: 'h1', key: 'text' });
    });
  });

  it('selectable click on a slot selects its block without a field focus', async () => {
    const { host, store } = renderFrame({
      html:
        '<section data-editor-block="sec1">' +
        '<div data-editor-slot="children"><p id="gap">gap</p></div>' +
        '</section>',
      selectable: true,
    });
    await waitFor(
      () => {
        expect(
          frontFrame(host).contentDocument?.querySelector('#gap'),
        ).not.toBeNull();
      },
      { timeout: 5000 },
    );
    const gap = frontFrame(host).contentDocument?.querySelector('#gap');
    if (!gap) throw new Error('missing slot child');
    await clickInFrame(host, gap);
    await waitFor(() => {
      const local = {
        selected: store.getSession().selection[0] ?? null,
        focus: store.getSession().focusedField,
        editing: store.getSession().editing,
      };
      expect(local?.selected).toBe('sec1');
      expect(local?.focus).toBeNull();
    });
  });

  it('form focus marks the block in the frame', async () => {
    const { host, store } = renderFrame({
      html: HEADING_HTML,
      selectable: true,
    });
    await waitFor(
      () => {
        expect(frontFrame(host).contentDocument).not.toBeNull();
        expect(
          frontFrame(host).contentDocument?.querySelector(
            '[data-editor-block="h1"]',
          ),
        ).not.toBeNull();
      },
      { timeout: 5000 },
    );
    act(() => {
      store.focus({ blockId: 'h1', key: 'text' });
    });
    await waitFor(() => {
      const section = frontFrame(host).contentDocument?.querySelector(
        '[data-editor-block="h1"]',
      );
      expect(section?.hasAttribute('data-editor-focused')).toBe(true);
    });
  });

  it('blob URL revoked on swap and unmount', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const origCreate = URL.createObjectURL.bind(URL);
    const origRevoke = URL.revokeObjectURL.bind(URL);
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      const url = origCreate(blob);
      created.push(url);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      revoked.push(url);
      origRevoke(url);
    });
    let n = 0;
    const { host, store, unmount } = renderFrame({
      render: async () => {
        n += 1;
        return new Blob([MINIMAL_PDF + String(n)], {
          type: 'application/pdf',
        });
      },
    });
    await waitFor(
      () => {
        expect(frontFrame(host).src.startsWith('blob:')).toBe(true);
        expect(created.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 5000 },
    );
    const firstUrl = created[0];
    act(() => {
      store.update('root_1', { title: 'Next' });
    });
    await waitFor(
      () => {
        expect(created.length).toBeGreaterThanOrEqual(2);
        expect(revoked).toContain(firstUrl);
      },
      { timeout: 5000 },
    );
    const remaining = created.filter((url) => !revoked.includes(url));
    unmount();
    for (const url of remaining) {
      expect(revoked).toContain(url);
    }
    vi.restoreAllMocks();
  });

  it('sandbox is empty by default and allow-same-origin when selectable', () => {
    const plain = renderFrame({ html: '<p>x</p>' });
    for (const frame of framesOf(plain.host)) {
      expect(frame.getAttribute('sandbox')).toBe('');
    }
    cleanup();
    const selectable = renderFrame({
      html: '<p>x</p>',
      selectable: true,
    });
    for (const frame of framesOf(selectable.host)) {
      expect(frame.getAttribute('sandbox')).toBe('allow-same-origin');
    }
  });

  it('stacked form plus selectable FramePreview writes field focus', async () => {
    const { host, getByTestId } = renderFrame({
      html: HEADING_HTML,
      selectable: true,
      extra: <Editor.Form blockId="h1" data-testid="form" />,
    });
    await waitFor(
      () => {
        expect(frontFrame(host).contentDocument).not.toBeNull();
        expect(
          frontFrame(host).contentDocument?.querySelector('h1'),
        ).not.toBeNull();
      },
      { timeout: 5000 },
    );
    const doc = frontFrame(host).contentDocument;
    if (doc === null) {
      throw new Error('contentDocument is null on selectable frame');
    }
    const heading = doc.querySelector('h1');
    if (!heading) throw new Error('missing heading');
    await clickInFrame(host, heading);
    await waitFor(() => {
      expect(
        getByTestId('form').querySelector('[data-focused]'),
      ).not.toBeNull();
    });
    // The click moves real focus into the field's control.
    await waitFor(() => {
      const active = document.activeElement;
      expect(active?.tagName).toBe('INPUT');
      expect(getByTestId('form').contains(active)).toBe(true);
    });
  });

  it.skipIf(noFrameListeners)(
    'keys pressed inside the frame run editor shortcuts',
    async () => {
      const { host, store } = renderFrame({
        html: HEADING_HTML,
        selectable: true,
      });
      await waitFor(
        () => {
          expect(
            frontFrame(host).contentDocument?.querySelector('h1'),
          ).not.toBeNull();
        },
        { timeout: 5000 },
      );
      const doc = frontFrame(host).contentDocument!;
      act(() => store.select('h1'));
      act(() => {
        doc.body.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Delete',
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      expect(store.getDoc().nodes.h1).toBeUndefined();
    },
  );

  it('invoice Blob shows a blob URL on the visible iframe', async () => {
    const { host } = renderFrame({
      render: async () => new Blob([MINIMAL_PDF], { type: 'application/pdf' }),
    });
    await waitFor(
      () => {
        expect(frontFrame(host).src.startsWith('blob:')).toBe(true);
      },
      { timeout: 5000 },
    );
  });
});

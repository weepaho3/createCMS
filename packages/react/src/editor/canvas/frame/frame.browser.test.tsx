import { act, cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditorStore } from '../../core/store';
import type { CanvasFrameOptions, CanvasFrameWrapper } from './frame-shell';

import { resetWarnings } from '../../core/codes';
import { makeDoc, storeSchema } from '../../core/store/fixtures';
import { Editor, useEditorContext } from '../../index';
import { Canvas } from '../index';
import { canvasBlocks } from '../test/fixtures';
import { emailFrame } from './presets';

afterEach(() => {
  cleanup();
  resetWarnings();
  vi.restoreAllMocks();
  for (const el of document.head.querySelectorAll('[data-test-style]')) {
    el.remove();
  }
});

type Bag = { store: EditorStore | null };

function Probe({ bag }: { bag: Bag }) {
  bag.store = useEditorContext('Probe').store;
  return null;
}

function renderFrame(
  options: {
    frame?: CanvasFrameOptions;
    wrapper?: CanvasFrameWrapper;
    overlay?: React.ReactNode;
    strict?: boolean;
    style?: React.CSSProperties;
  } = {},
) {
  const bag: Bag = { store: null };
  const ui = (frame?: CanvasFrameOptions) => (
    <Editor.Root schema={storeSchema} defaultValue={makeDoc()}>
      <Probe bag={bag} />
      <Canvas.Root
        data-testid="outer"
        components={canvasBlocks}
        surface="frame"
        frame={frame}
        wrapper={options.wrapper}
        style={{ width: 800, ...options.style }}
      >
        {options.overlay}
      </Canvas.Root>
    </Editor.Root>
  );
  const wrap = (node: React.ReactElement) =>
    options.strict ? <React.StrictMode>{node}</React.StrictMode> : node;
  const utils = render(wrap(ui(options.frame)));
  const outer = utils.getByTestId('outer');
  const frame = outer.querySelector('iframe')!;
  return {
    ...utils,
    outer,
    frame,
    store: () => bag.store!,
    rerenderFrame: (next: CanvasFrameOptions) => utils.rerender(wrap(ui(next))),
  };
}

/** The canvas element inside the frame, once the frame connected. */
async function canvasIn(frame: HTMLIFrameElement): Promise<HTMLElement> {
  let found: HTMLElement | null = null;
  await waitFor(
    () => {
      found =
        frame.contentDocument?.querySelector<HTMLElement>(
          '[data-editor-canvas]',
        ) ?? null;
      expect(found).not.toBeNull();
      expect(found!.querySelector('[data-editor-block="h1"]')).not.toBeNull();
    },
    { timeout: 5000 },
  );
  return found!;
}

describe('Canvas.Root surface="frame" lifecycle', () => {
  it('renders the canvas only after load, exactly once under StrictMode', async () => {
    const { frame } = renderFrame({ strict: true });
    // The initial about:blank document never gets the canvas.
    expect(
      frame.contentDocument?.querySelector('[data-editor-canvas]') ?? null,
    ).toBeNull();
    await canvasIn(frame);
    const doc = frame.contentDocument!;
    expect(doc.URL).toBe('about:srcdoc');
    expect(doc.querySelectorAll('[data-editor-frame-root]')).toHaveLength(1);
    expect(doc.querySelectorAll('[data-editor-canvas]')).toHaveLength(1);
    expect(
      doc.querySelector('[data-editor-frame-root]')?.getAttribute('translate'),
    ).toBe('no');
  });

  it('a reload remounts the canvas in the new document', async () => {
    const { frame } = renderFrame();
    await canvasIn(frame);
    const before = frame.contentDocument!;
    const oldRoot = before.querySelector('[data-editor-frame-root]')!;
    frame.contentWindow!.location.reload();
    await waitFor(
      () => {
        expect(frame.contentDocument).not.toBe(before);
        expect(
          frame.contentDocument?.querySelector('[data-editor-block="h1"]'),
        ).not.toBeNull();
      },
      { timeout: 5000 },
    );
    expect(oldRoot.childElementCount).toBe(0);
  });

  it('store updates from the host re-render a block inside the frame', async () => {
    const { frame, store } = renderFrame();
    const canvas = await canvasIn(frame);
    act(() => {
      store().update('h1', { text: 'Changed' });
    });
    await waitFor(() => {
      expect(
        canvas.querySelector('[data-editor-block="h1"]')?.textContent,
      ).toContain('Changed');
    });
  });

  it('unmount removes the load listener from the iframe', async () => {
    const remove = vi.spyOn(HTMLIFrameElement.prototype, 'removeEventListener');
    const { frame, unmount } = renderFrame();
    await canvasIn(frame);
    unmount();
    expect(remove.mock.calls.some(([type]) => type === 'load')).toBe(true);
  });
});

describe('frame head, body and styles', () => {
  it('head and body attributes change without a reload', async () => {
    const { frame, rerenderFrame } = renderFrame({
      frame: {
        styles: 'none',
        head: '<style>h1 { color: rgb(255, 0, 0); }</style>',
        bodyAttributes: { 'data-theme': 'light' },
      },
    });
    const canvas = await canvasIn(frame);
    const doc = frame.contentDocument!;
    const heading = () => canvas.querySelector('h1')!;
    expect(doc.defaultView!.getComputedStyle(heading()).color).toBe(
      'rgb(255, 0, 0)',
    );
    expect(doc.body.getAttribute('data-theme')).toBe('light');
    rerenderFrame({
      styles: 'none',
      head: '<style>h1 { color: rgb(0, 0, 255); }</style>',
      bodyAttributes: { 'data-theme': 'dark' },
    });
    expect(frame.contentDocument).toBe(doc);
    expect(doc.defaultView!.getComputedStyle(heading()).color).toBe(
      'rgb(0, 0, 255)',
    );
    expect(doc.body.getAttribute('data-theme')).toBe('dark');
  });

  it('mirrors host styles, follows later ones, and dedupes identical text', async () => {
    const style = document.createElement('style');
    style.setAttribute('data-test-style', '');
    style.textContent =
      '[data-editor-block="h1"] h1 { color: rgb(0, 128, 0); }';
    document.head.append(style);
    const twin = style.cloneNode(true) as HTMLStyleElement;
    document.head.append(twin);
    const { frame } = renderFrame();
    const canvas = await canvasIn(frame);
    const doc = frame.contentDocument!;
    const heading = canvas.querySelector('h1')!;
    expect(doc.defaultView!.getComputedStyle(heading).color).toBe(
      'rgb(0, 128, 0)',
    );
    const mirrored = Array.from(
      doc.head.querySelectorAll('[data-editor-mirrored]'),
    ).filter((el) => el.textContent === style.textContent);
    expect(mirrored).toHaveLength(1);
    const late = document.createElement('style');
    late.setAttribute('data-test-style', '');
    late.textContent = '[data-editor-block="h1"] h1 { font-size: 31px; }';
    document.head.append(late);
    await waitFor(() => {
      expect(doc.defaultView!.getComputedStyle(heading).fontSize).toBe('31px');
    });
  });

  it('styles: none mirrors nothing', async () => {
    const style = document.createElement('style');
    style.setAttribute('data-test-style', '');
    style.textContent = 'h1 { color: rgb(0, 128, 0); }';
    document.head.append(style);
    const { frame } = renderFrame({ frame: { styles: 'none' } });
    await canvasIn(frame);
    expect(
      frame.contentDocument!.head.querySelector('[data-editor-mirrored]'),
    ).toBeNull();
  });

  it('the e-mail preset: no body margin, sheet in the head, a centered table', async () => {
    const preset = emailFrame({
      sheet: 'h1 { font-size: 24px; color: rgb(0, 32, 96); }',
    });
    const { frame } = renderFrame({
      frame: { ...preset.frame, width: 700 },
      wrapper: preset.wrapper,
    });
    const canvas = await canvasIn(frame);
    const doc = frame.contentDocument!;
    const view = doc.defaultView!;
    expect(view.getComputedStyle(doc.body).marginTop).toBe('0px');
    expect(view.getComputedStyle(canvas.querySelector('h1')!).color).toBe(
      'rgb(0, 32, 96)',
    );
    const inner = doc.querySelector(
      '[data-editor-email-wrapper] table',
    ) as HTMLElement;
    expect(inner.getBoundingClientRect().width).toBe(600);
  });

  it('warns when html or body singletons take over the live frame', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    function Takeover() {
      return <body data-takeover="" />;
    }
    const { frame } = renderFrame({ overlay: <Takeover /> });
    await canvasIn(frame);
    await waitFor(() => {
      expect(
        warn.mock.calls.some(([text]) => String(text).includes('E011')),
      ).toBe(true);
    });
  });
});

describe('frame size', () => {
  it('auto height follows the content without an inner scrollbar', async () => {
    const { frame, store } = renderFrame({ frame: { styles: 'none' } });
    await canvasIn(frame);
    const doc = frame.contentDocument!;
    await waitFor(() => {
      expect(frame.getBoundingClientRect().height).toBeGreaterThan(0);
      expect(doc.documentElement.scrollHeight).toBeLessThanOrEqual(
        doc.documentElement.clientHeight,
      );
    });
    const before = frame.getBoundingClientRect().height;
    act(() => {
      for (let i = 0; i < 6; i++) {
        store().add('heading', { parent: { id: 'root_1' } });
      }
    });
    await waitFor(() => {
      expect(frame.getBoundingClientRect().height).toBeGreaterThan(before);
      expect(doc.documentElement.scrollHeight).toBeLessThanOrEqual(
        doc.documentElement.clientHeight,
      );
    });
  });

  it('a 100vh block trips the feedback-loop guard instead of growing forever', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { frame } = renderFrame({
      frame: {
        styles: 'none',
        head: '<style>[data-editor-canvas] { min-height: calc(100vh + 40px); }</style>',
      },
    });
    await canvasIn(frame);
    await waitFor(
      () => {
        expect(
          warn.mock.calls.some(([text]) => String(text).includes('E012')),
        ).toBe(true);
      },
      { timeout: 5000 },
    );
    expect(frame.getBoundingClientRect().height).toBeLessThan(20_000);
  });

  it('a fixed width is the frame viewport: media queries evaluate against it', async () => {
    const { frame } = renderFrame({
      frame: {
        styles: 'none',
        width: 768,
        scale: 1,
        head: '<style>h1 { color: rgb(1, 1, 1); } @media (min-width: 700px) { h1 { color: rgb(2, 2, 2); } }</style>',
      },
    });
    const canvas = await canvasIn(frame);
    const view = frame.contentWindow!;
    expect(view.innerWidth).toBe(768);
    expect(view.getComputedStyle(canvas.querySelector('h1')!).color).toBe(
      'rgb(2, 2, 2)',
    );
  });

  it('changing the width resizes the same iframe', async () => {
    const { frame, outer, rerenderFrame } = renderFrame({
      frame: { styles: 'none', width: 360, scale: 1 },
    });
    await canvasIn(frame);
    const doc = frame.contentDocument;
    rerenderFrame({ styles: 'none', width: 300, scale: 1 });
    await waitFor(() => {
      expect(frame.contentWindow!.innerWidth).toBe(300);
    });
    expect(outer.querySelector('iframe')).toBe(frame);
    expect(frame.contentDocument).toBe(doc);
  });

  it('fit scales a wide frame into the available width and maps coordinates', async () => {
    const { frame, outer } = renderFrame({
      frame: { styles: 'none', width: 760 },
      style: { width: 380 },
    });
    const canvas = await canvasIn(frame);
    // 380 available for 760: half size, layout width unchanged.
    expect(frame.contentWindow!.innerWidth).toBe(760);
    expect(frame.getBoundingClientRect().width).toBeCloseTo(380, 0);
    await waitFor(() => {
      expect(frame.getBoundingClientRect().height).toBeGreaterThan(20);
    });
    const block = canvas.querySelector('[data-editor-block="h1"]')!;
    const inFrame = block.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const hostX = frameRect.left + inFrame.left * 0.5;
    const hostY = frameRect.top + inFrame.top * 0.5;
    const hit = document.elementFromPoint(hostX + 2, hostY + 2);
    expect(hit).toBe(frame);
    expect(outer.querySelector('[data-editor-host-layer]')).not.toBeNull();
  });

  it.each(['sticky', 'fixed'])(
    'a %s block stays put in the frame and keeps its ring while it scrolls',
    async (position) => {
      const { frame, store } = renderFrame({
        frame: {
          styles: 'none',
          width: 600,
          height: 200,
          scale: 1,
          head: `<style>body { margin: 0 } [data-editor-block="h1"] { position: ${position} !important; top: 0; height: 30px; margin: 0; background: white; z-index: 1 } [data-editor-block="sec1"] { margin-top: 60px; height: 900px }</style>`,
        },
        overlay: (
          <Canvas.Overlay>
            <Canvas.SelectionRing data-testid="ring" />
          </Canvas.Overlay>
        ),
      });
      const canvas = await canvasIn(frame);
      const view = frame.contentWindow!;
      const block = canvas.querySelector('[data-editor-block="h1"]')!;
      act(() => store().select('h1'));
      const ring = () =>
        canvas.ownerDocument.querySelector<HTMLElement>(
          '[data-editor-selection-ring]',
        );
      await waitFor(() => expect(ring()).not.toBeNull());
      view.scrollTo(0, 300);
      await waitFor(() => expect(view.scrollY).toBeGreaterThan(200));
      // The frame is the viewport: the block pins to its top edge.
      expect(Math.abs(block.getBoundingClientRect().top)).toBeLessThan(1);
      await waitFor(() => {
        const a = ring()!.getBoundingClientRect();
        const b = block.getBoundingClientRect();
        expect(Math.abs(a.top - b.top)).toBeLessThan(1);
        expect(Math.abs(a.left - b.left)).toBeLessThan(1);
        expect(Math.abs(a.height - b.height)).toBeLessThan(1);
      });
    },
  );
});

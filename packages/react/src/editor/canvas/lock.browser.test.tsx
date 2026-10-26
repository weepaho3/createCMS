import type { ReactNode } from 'react';

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { EditorDocument } from '../core/document';
import type { EditProps } from '../core/edit';
import type { CanvasComponents } from './map';

import { defineEditorSchema } from '../core/schema';
import { createEditorStore } from '../core/store';
import { Editor } from '../index';
import { anchorsAt } from './hit';
import { Canvas } from './index';
import { clickThrough, waitForLayout } from './test/harness';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const schema = defineEditorSchema({
  root: { label: 'Page', fields: {}, slots: { children: {} } },
  components: {
    link: { label: 'Link', fields: {} },
    signup: { label: 'Signup', fields: {} },
    box: { label: 'Box', fields: {}, slots: { children: {} } },
    bare: { label: 'Bare', fields: {} },
  },
});

function doc(): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'r',
      type: 'root',
      props: {},
      slots: {
        children: [
          { id: 'l', type: 'link', props: {} },
          { id: 's', type: 'signup', props: {} },
          {
            id: 'b',
            type: 'box',
            props: {},
            slots: { children: [{ id: 'c', type: 'bare', props: {} }] },
          },
        ],
      },
    },
  };
}

const events = {
  submit: vi.fn(),
  linkClick: vi.fn(),
  auxClick: vi.fn(),
};

function Link({ edit }: { edit: EditProps }) {
  return (
    <a
      {...edit.block}
      href="#navigated"
      data-testid="link"
      onClick={events.linkClick}
      onAuxClick={events.auxClick}
      style={{ display: 'block', height: 40 }}
    >
      Pricing
    </a>
  );
}

function Signup({ edit }: { edit: EditProps }) {
  return (
    <form
      {...edit.block}
      onSubmit={(event) => {
        event.preventDefault();
        events.submit();
      }}
      style={{ height: 60 }}
    >
      <input data-testid="email" name="email" />
      <button type="submit">Join</button>
    </form>
  );
}

function Box({ edit, children }: { edit: EditProps; children?: ReactNode }) {
  return (
    <div {...edit.block} style={{ padding: 20, height: 100 }}>
      {children}
    </div>
  );
}

/** No box of its own: the documented `display: contents` escape. */
function Bare({ edit }: { edit: EditProps }) {
  return (
    <div {...edit.block} style={{ display: 'contents' }}>
      <span data-testid="bare" style={{ display: 'block', height: 30 }}>
        Bare
      </span>
    </div>
  );
}

const components = {
  link: Link,
  signup: Signup,
  box: Box,
  bare: Bare,
} as unknown as CanvasComponents;

function mount(surface: 'inline' | 'frame' = 'inline') {
  const store = createEditorStore({ schema, initialValue: doc() });
  const utils = render(
    <>
      <button type="button" data-testid="before">
        before
      </button>
      <Editor.Root store={store}>
        <Canvas.Root
          components={components}
          surface={surface}
          frame={surface === 'frame' ? { styles: 'none' } : undefined}
          data-testid="canvas"
          style={{ width: 600 }}
        />
      </Editor.Root>
    </>,
  );
  const host = utils.getByTestId('canvas');
  return { ...utils, host, store };
}

function byTestId(host: HTMLElement, id: string): HTMLElement {
  const el = host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`missing ${id}`);
  return el;
}

describe('locked canvas content', () => {
  it('wraps the blocks in an inert content element', () => {
    const { host } = mount();
    const content = host.querySelector('[data-editor-content]');
    expect(content).not.toBeNull();
    expect((content as HTMLElement).inert).toBe(true);
    expect(content!.contains(byTestId(host, 'link'))).toBe(true);
  });

  it('a click on a link selects the block and does not navigate', async () => {
    const { host, store } = mount();
    const link = byTestId(host, 'link');
    await waitForLayout(link);
    const before = location.hash;
    await clickThrough(link);
    expect(store.getSession().selection).toEqual(['l']);
    expect(events.linkClick).not.toHaveBeenCalled();
    expect(location.hash).toBe(before);
  });

  it('a middle click on a link reaches nothing', async () => {
    const { host } = mount();
    const link = byTestId(host, 'link');
    await waitForLayout(link);
    const canvas = host;
    const box = canvas.getBoundingClientRect();
    const r = link.getBoundingClientRect();
    await userEvent.click(canvas, {
      button: 'middle',
      position: { x: r.left - box.left + 5, y: r.top - box.top + 5 },
    });
    expect(events.auxClick).not.toHaveBeenCalled();
  });

  it('inputs take no focus from a click and Enter submits nothing', async () => {
    const { host, store } = mount();
    const input = byTestId(host, 'email') as HTMLInputElement;
    await waitForLayout(input);
    await clickThrough(input);
    expect(document.activeElement).not.toBe(input);
    expect(store.getSession().selection).toEqual(['s']);
    await userEvent.keyboard('hello{Enter}');
    expect(input.value).toBe('');
    expect(events.submit).not.toHaveBeenCalled();
  });

  it('Tab skips the controls inside the content', async () => {
    const { getByTestId, host } = mount();
    getByTestId('before').focus();
    await userEvent.tab();
    expect(host.contains(document.activeElement)).toBe(false);
  });

  it('a click in a nested block selects the innermost block', async () => {
    const { host, store } = mount();
    const bare = byTestId(host, 'bare');
    await waitForLayout(bare);
    await clickThrough(bare);
    expect(store.getSession().selection).toEqual(['c']);
    // The padding of the box belongs to the box.
    await clickThrough(bare, { offsetY: -10 });
    expect(store.getSession().selection).toEqual(['b']);
  });

  it('hover follows the pointer across inert blocks', async () => {
    const { host, store } = mount();
    const link = byTestId(host, 'link');
    await waitForLayout(link);
    const box = host.getBoundingClientRect();
    const r = link.getBoundingClientRect();
    await userEvent.hover(host, {
      position: { x: r.left - box.left + 5, y: r.top - box.top + 5 },
    });
    await vi.waitFor(() => expect(store.getEphemeral().hoverId).toBe('l'));
    const input = byTestId(host, 'email').getBoundingClientRect();
    await userEvent.hover(host, {
      position: { x: input.left - box.left + 5, y: input.top - box.top + 5 },
    });
    await vi.waitFor(() => expect(store.getEphemeral().hoverId).toBe('s'));
  });

  it('anchorsAt lists anchors front to back', async () => {
    const { host } = mount();
    const bare = byTestId(host, 'bare');
    await waitForLayout(bare);
    const r = bare.getBoundingClientRect();
    const ids = anchorsAt(host, r.left + 5, r.top + 5).map((el) =>
      el.getAttribute('data-editor-block'),
    );
    expect(ids).toEqual(['c', 'b']);
  });

  it('a synthetic event on a content element keeps its target', () => {
    const { host, store } = mount();
    act(() => {
      byTestId(host, 'link').dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(store.getSession().selection).toEqual(['l']);
  });

  it('locks the content of a frame surface the same way', async () => {
    const { getByTestId, store } = mount('frame');
    const frame = getByTestId('canvas').querySelector('iframe')!;
    let link: HTMLElement | null = null;
    await waitFor(
      () => {
        link = frame.contentDocument!.querySelector('[data-testid="link"]');
        expect(link).not.toBeNull();
        expect(link!.getBoundingClientRect().height).toBeGreaterThan(20);
      },
      { timeout: 5000 },
    );
    const content = frame.contentDocument!.querySelector(
      '[data-editor-content]',
    ) as HTMLElement;
    expect(content.inert).toBe(true);
    const r = link!.getBoundingClientRect();
    await userEvent.click(frame, {
      position: { x: r.left + 5, y: r.top + 5 },
    });
    expect(store.getSession().selection).toEqual(['l']);
    expect(events.linkClick).not.toHaveBeenCalled();
  });

  it('measures one path, not every anchor, in a large document', async () => {
    const sections = Array.from({ length: 20 }, (_, i) => ({
      id: `sec${i}`,
      type: 'box',
      props: {},
      slots: {
        children: Array.from({ length: 50 }, (_, j) => ({
          id: `b${i}_${j}`,
          type: 'bare',
          props: {},
        })),
      },
    }));
    const store = createEditorStore({
      schema,
      initialValue: {
        schemaVersion: 1,
        root: {
          id: 'r',
          type: 'root',
          props: {},
          slots: { children: sections },
        },
      },
    });
    const flat = {
      ...components,
      box: ({ edit, children }: { edit: EditProps; children?: ReactNode }) => (
        <div {...edit.block}>{children}</div>
      ),
    } as unknown as CanvasComponents;
    const utils = render(
      <Editor.Root store={store}>
        <Canvas.Root
          components={flat}
          data-testid="big"
          style={{ width: 600 }}
        />
      </Editor.Root>,
    );
    const host = utils.getByTestId('big');
    // The block is `display: contents`: its span carries the box.
    const target = host.querySelector('[data-editor-block="b7_20"] span')!;
    await waitForLayout(target);
    const r = target.getBoundingClientRect();
    // A fresh frame, so no box is cached.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    const hits = anchorsAt(host, r.left + 2, r.top + 2);
    const measured = spy.mock.calls.length;
    spy.mockRestore();
    expect(hits[0]!.getAttribute('data-editor-block')).toBe('b7_20');
    expect(hits[1]!.getAttribute('data-editor-block')).toBe('sec7');
    // 20 sections plus 50 blocks of one section (and their spans).
    expect(measured).toBeLessThan(150);
  });
});

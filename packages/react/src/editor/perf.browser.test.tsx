import { act, cleanup, render, waitFor } from '@testing-library/react';
import * as React from 'react';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { commands, server, userEvent } from 'vitest/browser';

import type { CanvasComponents } from './canvas';
import type { EditorDocument, NodeData } from './core/document';
import type { EditProps } from './core/edit';
import type { EditorStore } from './core/store';

import { Canvas } from './canvas';
import { dispatchPointer } from './canvas/test/harness';
import { isRichTextDoc } from './core/richtext/schema';
import { defineEditorSchema } from './core/schema';
import { Editor, useEditorContext } from './index';
import { RichTextStatic } from './render/rich-text';

// Performance smoke test on a 1000-block document (100 sections of 9
// blocks: headings and rich text paragraphs). Budgets, with headroom for a
// loaded CI runner:
// - an edit re-renders only the edited block; a hover re-renders no block;
// - typing into a field stays under the INP budget (Event Timing);
// - a 3 s pointer drag keeps at least 30 frames per second and handles a
//   pointer move (hit test, target, indicator) within one frame at p95.
// Chromium only: Event Timing and stable rAF pacing exist there. The
// measurements are written to .vitest/perf.json (a CI artifact).

const SECTIONS = 100;
const PER_SECTION = 9;
const INP_BUDGET_MS = 100;
const MIN_DRAG_FPS = 30;
const MOVE_P95_BUDGET_MS = 16;

const schema = defineEditorSchema({
  root: { label: 'Page', fields: {}, slots: { children: {} } },
  components: {
    section: {
      label: 'Section',
      fields: {},
      slots: { children: {} },
    },
    heading: {
      label: 'Heading',
      fields: { text: { type: 'text', label: 'Text' } },
    },
    paragraph: {
      label: 'Paragraph',
      fields: { body: { type: 'richText', label: 'Body' } },
    },
  },
});

function bigDoc(): EditorDocument {
  const sections: NodeData[] = [];
  for (let s = 0; s < SECTIONS; s++) {
    const children: NodeData[] = [];
    for (let i = 0; i < PER_SECTION; i++) {
      const id = `s${s}b${i}`;
      children.push(
        i % 2 === 0
          ? { id, type: 'heading', props: { text: `Heading ${id}` } }
          : {
              id,
              type: 'paragraph',
              props: {
                body: {
                  type: 'doc',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: `Paragraph ${id}` }],
                    },
                  ],
                },
              },
            },
      );
    }
    sections.push({
      id: `s${s}`,
      type: 'section',
      props: {},
      slots: { children },
    });
  }
  return {
    schemaVersion: 1,
    root: {
      id: 'root',
      type: 'root',
      props: {},
      slots: { children: sections },
    },
  };
}

/** Render count per block id. */
const renders = new Map<string, number>();
const counted = (id: string) => renders.set(id, (renders.get(id) ?? 0) + 1);

type BlockProps = {
  id: string;
  props: Record<string, unknown>;
  edit: EditProps;
  children?: React.ReactNode;
};

const components = {
  section: ({ id, edit, children }: BlockProps) => {
    counted(id);
    return (
      <section {...edit.block} style={{ padding: 4 }}>
        {children}
      </section>
    );
  },
  heading: ({ id, props, edit }: BlockProps) => {
    counted(id);
    return (
      <h2 {...edit.block} style={{ margin: 0, height: 24, fontSize: 16 }}>
        <span {...edit.field.text}>
          {typeof props.text === 'string' ? props.text : ''}
        </span>
      </h2>
    );
  },
  paragraph: ({ id, props, edit }: BlockProps) => {
    counted(id);
    return (
      <div {...edit.block} style={{ height: 24 }}>
        <RichTextStatic value={isRichTextDoc(props.body) ? props.body : null} />
      </div>
    );
  },
} as unknown as CanvasComponents;

type Bag = { store: EditorStore | null };
function Probe({ bag }: { bag: Bag }) {
  bag.store = useEditorContext('Probe').store;
  return null;
}

const results: Record<string, unknown> = {};

function mount(selected: string) {
  const bag: Bag = { store: null };
  const utils = render(
    <Editor.Root schema={schema} defaultValue={bigDoc()}>
      <Probe bag={bag} />
      <div style={{ display: 'flex', height: 600 }}>
        <div style={{ width: 300, overflow: 'auto' }}>
          <Editor.Field blockId={selected} name="text">
            <Editor.FieldLabel />
            <Editor.FieldControl />
          </Editor.Field>
        </div>
        <Canvas.Root
          data-testid="canvas"
          components={components}
          style={{ width: 500, height: 600, overflow: 'auto' }}
        >
          <Canvas.Overlay>
            <Canvas.DropIndicator />
            <Canvas.BlockToolbar side="top">
              <Canvas.DragHandle blockId={selected} />
            </Canvas.BlockToolbar>
          </Canvas.Overlay>
        </Canvas.Root>
      </div>
    </Editor.Root>,
  );
  return { ...utils, store: () => bag.store! };
}

const last = `s${SECTIONS - 1}b${PER_SECTION - 1}`;
const ready = () =>
  waitFor(
    () =>
      expect(
        document.querySelector(`[data-editor-block="${last}"]`),
      ).not.toBeNull(),
    { timeout: 20_000 },
  );

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
};

afterEach(cleanup);

afterAll(async () => {
  if (server.browser !== 'chromium') return;
  await commands.writeFile(
    '.vitest/perf.json',
    `${JSON.stringify(results, null, 2)}\n`,
  );
});

describe.skipIf(server.browser !== 'chromium')('1000-block editor', () => {
  it('an edit renders only the edited block; a hover renders none', async () => {
    const { store } = mount('s50b0');
    await ready();
    renders.clear();
    act(() => {
      store().update('s50b0', { text: 'Edited' });
    });
    const afterEdit = Object.fromEntries(renders);
    renders.clear();
    act(() => {
      store().hover('s60b2');
    });
    const afterHover = Object.fromEntries(renders);
    results.renderCounts = { afterEdit, afterHover };
    expect(afterEdit).toEqual({ s50b0: 1 });
    expect(afterHover).toEqual({});
  }, 60_000);

  it('typing into a field stays under the INP budget', async () => {
    mount('s10b0');
    await ready();
    const durations: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) durations.push(entry.duration);
    });
    observer.observe({
      type: 'event',
      durationThreshold: 16,
      buffered: false,
    } as PerformanceObserverInit);
    const input = document.querySelector<HTMLInputElement>(
      '[data-editor-field] input, input',
    )!;
    input.focus();
    await userEvent.keyboard(' typed on a big page');
    await new Promise((resolve) => setTimeout(resolve, 200));
    observer.disconnect();
    const worst = durations.length > 0 ? Math.max(...durations) : 0;
    results.typing = {
      keys: 20,
      slowEvents: durations.length,
      worstEventMs: worst,
    };
    expect(input.value).toContain('typed on a big page');
    expect(worst).toBeLessThanOrEqual(INP_BUDGET_MS);
  }, 60_000);

  it('a 3 s pointer drag keeps the frame rate and a fast hit test', async () => {
    const { store, getByTestId } = mount('s20b0');
    await ready();
    act(() => {
      store().select('s20b0');
    });
    const handle = await waitFor(() => {
      const el = document.querySelector('[data-editor-drag-handle]');
      expect(el).not.toBeNull();
      return el!;
    });
    const canvas = getByTestId('canvas').getBoundingClientRect();
    const box = handle.getBoundingClientRect();
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    dispatchPointer(handle, 'pointerdown', from);
    dispatchPointer(handle, 'pointermove', { x: from.x + 8, y: from.y + 8 });

    const frames: number[] = [];
    const moves: number[] = [];
    // The drag must be live: the drop indicator shows while it runs.
    let indicatorFrames = 0;
    const started = performance.now();
    let previous = started;
    await new Promise<void>((resolve) => {
      const step = (now: number) => {
        frames.push(now - previous);
        previous = now;
        const t = (now - started) / 3000;
        const point = {
          x: canvas.x + canvas.width / 2,
          y: canvas.y + 40 + (canvas.height - 80) * Math.abs(Math.sin(t * 6)),
        };
        const t0 = performance.now();
        dispatchPointer(handle, 'pointermove', point);
        moves.push(performance.now() - t0);
        if (document.querySelector('[data-editor-drop-indicator]')) {
          indicatorFrames += 1;
        }
        if (now - started < 3000) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    dispatchPointer(handle, 'pointermove', from);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    dispatchPointer(handle, 'pointerup', from);

    const seconds = (performance.now() - started) / 1000;
    const fps = frames.length / seconds;
    const moveP95 = percentile(moves, 0.95);
    results.drag = {
      seconds: Number(seconds.toFixed(2)),
      frames: frames.length,
      fps: Number(fps.toFixed(1)),
      frameP95Ms: Number(percentile(frames, 0.95).toFixed(1)),
      moveMedianMs: Number(percentile(moves, 0.5).toFixed(2)),
      moveP95Ms: Number(moveP95.toFixed(2)),
      indicatorFrames,
    };
    expect(indicatorFrames).toBeGreaterThan(frames.length / 2);
    expect(fps).toBeGreaterThanOrEqual(MIN_DRAG_FPS);
    expect(moveP95).toBeLessThanOrEqual(MOVE_P95_BUDGET_MS);
  }, 60_000);
});

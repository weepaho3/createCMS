import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from 'vitest/browser';

import type { EditorDocument, NodeData } from '../../core/document';
import type { EditorStore } from '../../core/store';

import { storeSchema } from '../../core/store/fixtures';
import { Editor, useEditorContext } from '../../index';
import { Canvas } from '../index';
import { canvasBlocks } from '../test/fixtures';

// Smoke budget for the frame surface on a production-sized document: an
// edit inside the frame may cost at most 1.5 times (plus 2 ms of timer
// noise) what it costs inline. Chromium only (heap figures exist there).

afterEach(cleanup);

const BLOCKS = 1000;
const EDITS = 30;

function bigDoc(): EditorDocument {
  const children: NodeData[] = [];
  for (let i = 0; i < BLOCKS; i++) {
    children.push({
      id: `b${i}`,
      type: 'heading',
      props: { text: `Block ${i}`, level: 2 },
    });
  }
  return {
    schemaVersion: 1,
    root: {
      id: 'root_1',
      type: 'root',
      props: { title: 'Big' },
      slots: { children },
    },
  };
}

type Bag = { store: EditorStore | null };
function Probe({ bag }: { bag: Bag }) {
  bag.store = useEditorContext('Probe').store;
  return null;
}

async function measure(surface: 'inline' | 'frame') {
  const bag: Bag = { store: null };
  const heap = () =>
    (performance as Performance & { memory?: { usedJSHeapSize: number } })
      .memory?.usedJSHeapSize ?? 0;
  const before = heap();
  const started = performance.now();
  const { getByTestId } = render(
    <Editor.Root schema={storeSchema} defaultValue={bigDoc()}>
      <Probe bag={bag} />
      <Canvas.Root
        data-testid="canvas"
        components={canvasBlocks}
        surface={surface}
        frame={{ styles: 'none' }}
      />
    </Editor.Root>,
  );
  const outer = getByTestId('canvas');
  const docOf = () =>
    surface === 'frame'
      ? outer.querySelector('iframe')!.contentDocument!
      : document;
  await waitFor(
    () => {
      expect(
        docOf().querySelector(`[data-editor-block="b${BLOCKS - 1}"]`),
      ).not.toBeNull();
    },
    { timeout: 20_000 },
  );
  const mountMs = performance.now() - started;
  const doc = docOf();
  const durations: number[] = [];
  for (let i = 0; i < EDITS; i++) {
    const target = doc.querySelector(`[data-editor-block="b${i * 30}"]`)!;
    const t0 = performance.now();
    act(() => {
      bag.store!.update(`b${i * 30}`, { text: `Edited ${i}` });
    });
    expect(target.textContent).toContain(`Edited ${i}`);
    durations.push(performance.now() - t0);
  }
  durations.sort((a, b) => a - b);
  const result = {
    mountMs: Math.round(mountMs),
    editMedianMs: durations[Math.floor(durations.length / 2)]!,
    heapDelta: heap() - before,
  };
  cleanup();
  return result;
}

describe.skipIf(server.browser !== 'chromium')('frame surface cost', () => {
  it('an edit in a 1000-block frame stays within 1.5x of inline', async () => {
    const inline = await measure('inline');
    const frame = await measure('frame');
    expect(frame.editMedianMs).toBeLessThanOrEqual(
      inline.editMedianMs * 1.5 + 2,
    );
  }, 120_000);
});

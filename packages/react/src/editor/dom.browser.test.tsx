import { afterEach, describe, expect, it } from 'vitest';

import type { EditorNodes } from './core/store';

import { createInsertAdapters } from './canvas/insert-dom';
import { createMeasurer, type Measurer } from './canvas/measurer';
import { isHTMLElement, viewOf } from './dom';

const frames: HTMLIFrameElement[] = [];
const measurers: Measurer[] = [];

afterEach(() => {
  for (const measurer of measurers.splice(0)) measurer.destroy();
  for (const frame of frames.splice(0)) frame.remove();
});

async function sameOriginFrame(body: string): Promise<Document> {
  const frame = document.createElement('iframe');
  frames.push(frame);
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
  });
  frame.srcdoc = `<!doctype html><html><body>${body}</body></html>`;
  document.body.append(frame);
  await loaded;
  const doc = frame.contentDocument;
  if (!doc) throw new Error('iframe document is not accessible');
  return doc;
}

const singleCellRow: EditorNodes = {
  root: {
    id: 'root',
    type: 'root',
    props: {},
    parent: null,
    slots: { children: ['stack1'] },
  },
  stack1: {
    id: 'stack1',
    type: 'stack',
    props: {},
    parent: { id: 'root', slot: 'children' },
    slots: { children: ['c1'] },
  },
  c1: {
    id: 'c1',
    type: 'cell',
    props: {},
    parent: { id: 'stack1', slot: 'children' },
    slots: {},
  },
};

describe('realm-safe dom guards in a same-origin iframe', () => {
  it('recognises frame elements as html elements', async () => {
    const doc = await sameOriginFrame('<div id="probe"></div>');
    const probe = doc.getElementById('probe');
    expect(probe instanceof HTMLElement).toBe(false);
    expect(isHTMLElement(probe)).toBe(true);
    expect(viewOf(probe)).toBe(doc.defaultView);
  });

  it('keeps the single child row flow gate working inside the frame', async () => {
    const doc = await sameOriginFrame(
      '<div id="canvas"><div data-editor-block="stack1" style="display:flex;flex-direction:row">' +
        '<div data-editor-block="c1" style="width:40px;height:40px"></div>' +
        '</div></div>',
    );
    const canvas = doc.getElementById('canvas');
    if (!isHTMLElement(canvas)) throw new Error('canvas missing');
    const measurer = createMeasurer(canvas);
    measurers.push(measurer);

    const adapters = createInsertAdapters(
      canvas,
      measurer,
      singleCellRow,
      'root',
    );
    expect(adapters.isRowFlow({ id: 'stack1', slot: 'children' })).toBe(true);
  });
});

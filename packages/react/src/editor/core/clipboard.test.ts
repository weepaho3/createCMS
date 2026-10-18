import { describe, expect, it } from 'vitest';

import type { ClipboardPayload } from './clipboard';

import {
  CLIPBOARD_APP,
  CLIPBOARD_VERSION,
  copyBlocks,
  copyProps,
  decodeClipboard,
  encodeClipboardHtml,
  parseClipboardPayload,
  pasteBlocks,
  pasteProps,
  plainTextOf,
  removeSelected,
} from './clipboard';
import { createEditorStore } from './store';
import { counterGenId, makeDoc, storeSchema } from './store/fixtures';

const makeStore = () =>
  createEditorStore({
    schema: storeSchema,
    initialValue: makeDoc(),
    genId: counterGenId(),
  });

describe('clipboard payload', () => {
  it('round-trips through text/html, including non-ASCII text', () => {
    const store = makeStore();
    store.update('h1', { text: 'Grüße 👋' });
    store.select('h1');
    const payload = copyBlocks(store)!;
    const html = encodeClipboardHtml(payload, 'Grüße <b>');
    expect(html).toContain('Grüße &lt;b&gt;');
    expect(decodeClipboard({ html })).toEqual(payload);
    expect(decodeClipboard({ json: JSON.stringify(payload) })).toEqual(payload);
  });

  it('rejects foreign or malformed payloads', () => {
    const base = { app: CLIPBOARD_APP, version: CLIPBOARD_VERSION };
    expect(parseClipboardPayload({ ...base, kind: 'blocks', blocks: [] })).toBe(
      null,
    );
    expect(
      parseClipboardPayload({
        ...base,
        kind: 'blocks',
        blocks: [{ id: 1, type: 'heading', props: {} }],
      }),
    ).toBe(null);
    expect(
      parseClipboardPayload({
        app: 'other',
        version: 1,
        kind: 'blocks',
        blocks: [{ id: 'a', type: 'heading', props: {} }],
      }),
    ).toBe(null);
    expect(decodeClipboard({ html: '<p>hello</p>' })).toBe(null);
    expect(decodeClipboard({ json: '{not json' })).toBe(null);
  });

  it('copies only the outermost selected blocks, in document order', () => {
    const store = makeStore();
    store.setSelection(['p1', 'sec1', 'h1']);
    const payload = copyBlocks(store);
    expect(
      payload?.kind === 'blocks' && payload.blocks.map((b) => b.id),
    ).toEqual(['h1', 'sec1']);
    expect(plainTextOf(payload?.kind === 'blocks' ? payload.blocks : [])).toBe(
      'Hello\nSec\nWorld',
    );
  });
});

describe('pasteBlocks', () => {
  it('pastes after the selection with fresh ids and selects the copies', () => {
    const store = makeStore();
    store.select('h1');
    const payload = copyBlocks(store)!;
    const ids = pasteBlocks(store, payload);
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe('h1');
    const root = store.getDoc().nodes.root_1!.slots.children;
    expect(root).toEqual(['h1', ids[0], 'sec1']);
    expect(store.getSession().selection).toEqual(ids);
  });

  it('pastes into a selected container whose slot is empty', () => {
    const store = makeStore();
    store.remove('p1');
    store.select('h1');
    const payload = copyBlocks(store)!;
    store.select('sec1');
    const [id] = pasteBlocks(store, payload);
    expect(store.getDoc().nodes.sec1!.slots.children).toEqual([id]);
  });

  it('refuses a type the slot does not take, and unknown types', () => {
    const store = makeStore();
    const rejected: string[] = [];
    store.on('opRejected', ({ origin }) => rejected.push(origin));
    const image: ClipboardPayload = {
      app: CLIPBOARD_APP,
      version: CLIPBOARD_VERSION,
      kind: 'blocks',
      blocks: [{ id: 'x', type: 'image', props: {} }],
    };
    store.select('p1');
    expect(pasteBlocks(store, image)).toEqual([]);
    const unknown: ClipboardPayload = {
      ...image,
      blocks: [{ id: 'y', type: 'carousel', props: {} }],
    };
    expect(pasteBlocks(store, unknown)).toEqual([]);
    expect(rejected).toEqual(['local', 'local']);
    expect(store.getDoc().nodes.sec1!.slots.children).toEqual(['p1']);
  });

  it('cut removes the selection in one undo step', () => {
    const store = makeStore();
    store.setSelection(['h1', 'sec1']);
    expect(removeSelected(store)).toBe(true);
    expect(store.getDoc().nodes.root_1!.slots.children).toEqual([]);
    store.undo();
    expect(store.getDoc().nodes.root_1!.slots.children).toEqual(['h1', 'sec1']);
  });
});

describe('props clipboard', () => {
  it('pastes props onto selected blocks of the same type only', () => {
    const store = makeStore();
    store.select('h1');
    const payload = copyProps(store)!;
    const second = store.add('heading', { parent: { id: 'root_1' } })!;
    store.setSelection([second, 'sec1']);
    expect(pasteProps(store, payload)).toBe(true);
    expect(store.getDoc().nodes[second]!.props.text).toBe('Hello');
    expect(store.getDoc().nodes.sec1!.props.title).toBe('Sec');
  });

  it('the commands keep the last copy for paste without permission', async () => {
    const store = makeStore();
    store.select('h1');
    expect(store.commands.execute('clipboard.copy')).toBe(true);
    const ids = (await store.commands.execute('clipboard.paste')) as string[];
    expect(ids).toHaveLength(1);
    expect(store.commands.canExecute('clipboard.pasteProps')).toBe(false);
    store.commands.execute('clipboard.copyProps');
    expect(store.commands.canExecute('clipboard.pasteProps')).toBe(true);
  });
});

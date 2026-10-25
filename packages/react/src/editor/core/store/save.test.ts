import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PersistenceOptions } from './types';

import { EditorAdapterError } from '../adapter';
import { counterGenId, makeDoc, storeSchema } from './fixtures';
import { SAVE_DEBOUNCE_MS, SAVE_MAX_WAIT_MS, SAVE_RETRY_BASE_MS } from './save';
import { createEditorStore } from './store';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeStore(persistence: Partial<PersistenceOptions> = {}) {
  let version = 0;
  const save = vi.fn<PersistenceOptions['save']>(async () => ({
    version: `v${++version}`,
  }));
  const store = createEditorStore({
    schema: storeSchema,
    initialValue: makeDoc(),
    genId: counterGenId(),
    persistence: { save, baseVersion: 'v0', ...persistence },
  });
  return { store, save };
}

const type = (store: ReturnType<typeof makeStore>['store'], text: string) =>
  store.update('h1', { text }, { coalesce: true });

describe('autosave', () => {
  it('saves once after the debounce with the ops since the last save and the base version', async () => {
    const { store, save } = makeStore();
    type(store, 'A');
    type(store, 'AB');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    const [doc, ctx] = save.mock.calls[0]!;
    expect(doc.root.slots?.children?.[0]?.props.text).toBe('AB');
    expect(ctx.ops).toHaveLength(2);
    expect(ctx.baseVersion).toBe('v0');
    expect(store.getSession().save).toMatchObject({
      status: 'idle',
      dirty: false,
      version: 'v1',
    });
  });

  it('saves at least every maxWait while typing continues', async () => {
    const { store, save } = makeStore();
    for (let t = 0; t < SAVE_MAX_WAIT_MS; t += 500) {
      type(store, `t${t}`);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('never runs two saves at once; a change during a save is saved after it', async () => {
    const { store, save } = makeStore();
    const first = deferred<{ version: string }>();
    save.mockImplementationOnce(() => first.promise);
    type(store, 'A');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);
    type(store, 'AB');
    void store.save();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(save).toHaveBeenCalledTimes(1);
    first.resolve({ version: 'v1' });
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[1].baseVersion).toBe('v1');
    expect(save.mock.calls[1]?.[1].ops).toHaveLength(1);
  });

  it('remote changes are not saved', async () => {
    const { store, save } = makeStore();
    store.applyRemote([{ op: 'update', id: 'h1', patch: { text: 'R' } }]);
    await vi.advanceTimersByTimeAsync(SAVE_MAX_WAIT_MS);
    expect(save).not.toHaveBeenCalled();
    expect(store.isDirty()).toBe(false);
  });

  it('autosave: false saves only on save()', async () => {
    const { store, save } = makeStore({ autosave: false });
    type(store, 'A');
    await vi.advanceTimersByTimeAsync(SAVE_MAX_WAIT_MS);
    expect(save).not.toHaveBeenCalled();
    await store.save({ message: 'm' });
    expect(save.mock.calls[0]?.[1].message).toBe('m');
  });
});

describe('failures', () => {
  it('retries network failures with exponential backoff', async () => {
    const { store, save } = makeStore({ autosave: false });
    save.mockRejectedValueOnce(new EditorAdapterError('network', 'offline'));
    save.mockRejectedValueOnce(new EditorAdapterError('network', 'offline'));
    type(store, 'A');
    await store.save();
    expect(store.getSession().save.status).toBe('error');
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_BASE_MS);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_BASE_MS);
    expect(save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_BASE_MS);
    expect(save).toHaveBeenCalledTimes(3);
    expect(store.getSession().save).toMatchObject({
      status: 'idle',
      dirty: false,
    });
  });

  it('does not retry validation failures', async () => {
    const { store, save } = makeStore({ autosave: false });
    save.mockRejectedValueOnce(new EditorAdapterError('validation', 'bad'));
    type(store, 'A');
    await store.save();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(store.getSession().save).toMatchObject({
      status: 'error',
      dirty: true,
    });
  });

  it('a conflict keeps local changes and offers the server document', async () => {
    const serverDoc = makeDoc();
    const { store, save } = makeStore();
    save.mockRejectedValueOnce(
      new EditorAdapterError('conflict', 'moved on', {
        serverDoc,
        serverVersion: 'v9',
      }),
    );
    type(store, 'Mine');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(store.getSession().save).toMatchObject({
      status: 'conflict',
      dirty: true,
      conflict: { serverDoc, serverVersion: 'v9' },
    });
    expect(store.getDoc().nodes.h1?.props.text).toBe('Mine');
    type(store, 'Mine 2');
    await vi.advanceTimersByTimeAsync(SAVE_MAX_WAIT_MS);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('overwrite saves with force and without a base version', async () => {
    const { store, save } = makeStore();
    save.mockRejectedValueOnce(new EditorAdapterError('conflict', 'moved on'));
    type(store, 'Mine');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    await store.save({ force: true });
    expect(save.mock.calls[1]?.[1]).toMatchObject({ force: true });
    expect(save.mock.calls[1]?.[1].baseVersion).toBeUndefined();
    expect(store.getSession().save.status).toBe('idle');
  });

  it('reloadFromServer loads the server document as the new base', async () => {
    const serverDoc = makeDoc();
    serverDoc.root.props.title = 'Server';
    const { store, save } = makeStore();
    save.mockRejectedValueOnce(
      new EditorAdapterError('conflict', 'moved on', {
        serverDoc,
        serverVersion: 'v9',
      }),
    );
    type(store, 'Mine');
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    expect(store.reloadFromServer()).toBe(true);
    expect(store.getDocument().root.props.title).toBe('Server');
    expect(store.getSession().save).toMatchObject({
      status: 'idle',
      dirty: false,
      version: 'v9',
    });
  });
});

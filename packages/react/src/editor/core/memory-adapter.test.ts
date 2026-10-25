import { describe, expect, it } from 'vitest';

import type { EditorDocument } from './document';

import { EditorAdapterError } from './adapter';
import { createMemoryAdapter } from './memory-adapter';

const doc: EditorDocument = {
  schemaVersion: 1,
  root: { id: 'root', type: 'root', props: { title: 'Home' } },
};

describe('createMemoryAdapter', () => {
  it('loads copies and versions every save', async () => {
    const adapter = createMemoryAdapter({ home: doc });
    const loaded = await adapter.load('home');
    expect(loaded).toEqual(doc);
    expect(loaded).not.toBe(doc);
    expect(adapter.version('home')).toBe('1');

    const next = { ...doc, root: { ...doc.root, props: { title: 'Start' } } };
    await expect(
      adapter.save('home', next, { ops: [], baseVersion: '1' }),
    ).resolves.toEqual({ version: '2' });
    expect(adapter.get('home')?.root.props.title).toBe('Start');
  });

  it('rejects a stale base version as a conflict and unknown ids as not-found', async () => {
    const adapter = createMemoryAdapter({ home: doc });
    await adapter.save('home', doc, { ops: [] });
    const stale = adapter.save('home', doc, { ops: [], baseVersion: '1' });
    await expect(stale).rejects.toBeInstanceOf(EditorAdapterError);
    await expect(stale).rejects.toMatchObject({ kind: 'conflict' });
    await expect(adapter.load('nope')).rejects.toMatchObject({
      kind: 'not-found',
    });
  });
});

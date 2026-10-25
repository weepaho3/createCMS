import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EditorDocument } from './document';

import { defineEditorSchema } from './schema';
import { createWorkerTasks, serveWorkerTasks } from './worker';

const schema = defineEditorSchema({
  root: { label: 'Root', fields: {}, slots: { children: {} } },
  components: {
    text: { label: 'Text', fields: { body: { type: 'text', required: true } } },
  },
});

function docOf(count: number): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'r',
      type: 'root',
      props: {},
      slots: {
        children: Array.from({ length: count }, (_, i) => ({
          id: `t${i}`,
          type: 'text',
          props: {},
        })),
      },
    },
  };
}

const channels: MessageChannel[] = [];
afterEach(() => {
  for (const channel of channels.splice(0)) {
    channel.port1.close();
    channel.port2.close();
  }
});

function connect() {
  const channel = new MessageChannel();
  channels.push(channel);
  const stop = serveWorkerTasks(channel.port2, { schema });
  channel.port1.start();
  channel.port2.start();
  return { main: channel.port1, worker: channel.port2, stop };
}

describe('worker tasks', () => {
  it('validates a large document on the worker side', async () => {
    const { main, worker } = connect();
    const posted = vi.spyOn(main, 'postMessage');
    const tasks = createWorkerTasks({ schema, worker: main, threshold: 10 });
    const issues = await tasks.validateDocument(docOf(20), {
      phase: 'publish',
    });
    expect(posted).toHaveBeenCalledTimes(1);
    expect(issues.filter((issue) => issue.code === 'required')).toHaveLength(
      20,
    );
    tasks.dispose();
    void worker;
  });

  it('keeps small documents on the main thread', async () => {
    const { main } = connect();
    const posted = vi.spyOn(main, 'postMessage');
    const tasks = createWorkerTasks({ schema, worker: main, threshold: 10 });
    const issues = await tasks.validateDocument(docOf(2), { phase: 'publish' });
    expect(posted).not.toHaveBeenCalled();
    expect(issues).toHaveLength(2);
  });

  it('runs everything on the main thread without a worker', async () => {
    const tasks = createWorkerTasks({ schema });
    const base = docOf(600);
    const local = structuredClone(base);
    local.root.slots!.children![0]!.props.body = 'mine';
    const result = await tasks.mergeByNode(base, local, base);
    expect(result.ok).toBe(true);
  });

  it('merges on the worker and rejects pending tasks on dispose', async () => {
    const { main } = connect();
    const tasks = createWorkerTasks({ schema, worker: main, threshold: 1 });
    const base = docOf(3);
    const result = await tasks.mergeByNode(base, base, base);
    expect(result.ok).toBe(true);
    const pending = tasks.validateDocument(docOf(3));
    tasks.dispose();
    await expect(pending).rejects.toThrow('disposed');
  });
});

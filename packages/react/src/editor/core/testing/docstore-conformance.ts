import type { EditorDocument, Origin } from '../document';
import type { Change, DocState, DocStore } from '../store/types';

import { TxRejectedError } from '../store/doc-store';
import { serializeSubtree } from '../store/serde';

export type DocStoreConformanceOptions = {
  /**
   * Check that consecutive writes with the same `mergeKey` become one undo
   * step. Default `true`; turn it off for a store without merging.
   */
  merge?: boolean;
};

/** A `DocStore` requirement the store under test does not meet. */
export class DocStoreConformanceError extends Error {
  readonly check: string;

  constructor(check: string, message: string) {
    super(`${check}: ${message}`);
    this.name = 'DocStoreConformanceError';
    this.check = check;
  }
}

/** The document every check starts from (`createStore` gets a fresh copy). */
export function conformanceDocument(): EditorDocument {
  return {
    schemaVersion: 1,
    root: {
      id: 'root',
      type: 'root',
      props: { title: 'Page' },
      slots: {
        children: [
          { id: 'a', type: 'text', props: { text: 'A' } },
          {
            id: 'box',
            type: 'box',
            props: {},
            slots: {
              children: [{ id: 'b', type: 'text', props: { text: 'B' } }],
            },
          },
          { id: 'c', type: 'text', props: { text: 'C' } },
        ],
      },
    },
  };
}

const json = (state: DocState) =>
  JSON.stringify(serializeSubtree(state.nodes, state.rootId));

const childrenOf = (state: DocState, id: string, slot = 'children') =>
  state.nodes[id]?.slots[slot] ?? [];

type Check = (create: () => DocStore) => void;

/**
 * The `DocStore` contract as checks: transactions are all or nothing,
 * `origin` reaches subscribers, change events name what changed, a move
 * never shows a node in two places, local writes are undoable while remote,
 * history and `history: 'ignore'` writes are not, marks squash and bail,
 * and `mergeKey` merges. `createStore` returns a new store holding
 * `conformanceDocument()` on every call. Throws a `DocStoreConformanceError`
 * naming the first failed check; returns the names of the passed ones.
 * Framework-free, so a third-party store can run it from any test runner.
 */
export function runDocStoreConformance(
  createStore: (initialValue: EditorDocument) => DocStore,
  options: DocStoreConformanceOptions = {},
): string[] {
  const fail = (check: string, message: string): never => {
    throw new DocStoreConformanceError(check, message);
  };
  const expect = (check: string, ok: boolean, message: string) => {
    if (!ok) fail(check, message);
  };

  const checks: Record<string, Check> = {
    'holds the initial document': (create) => {
      const store = create();
      const state = store.getSnapshot();
      expect(
        'holds the initial document',
        json(state) === JSON.stringify(conformanceDocument().root) &&
          state.schemaVersion === 1,
        `snapshot is ${json(state)}`,
      );
    },

    'applies a transaction and returns ops and inverses': (create) => {
      const check = 'applies a transaction and returns ops and inverses';
      const store = create();
      const before = store.getSnapshot();
      const result = store.transact((tx) => {
        tx.setProp('a', ['text'], 'A2');
        tx.insertNode({ id: 'root', slot: 'children' }, 0, {
          id: 'n',
          type: 'text',
          props: { text: 'N' },
        });
      });
      const after = store.getSnapshot();
      expect(check, result.ops.length === 2, `ops: ${result.ops.length}`);
      expect(
        check,
        result.inverse.length === 2,
        `inverses: ${result.inverse.length}`,
      );
      expect(check, after.nodes.a?.props.text === 'A2', 'prop not set');
      expect(check, childrenOf(after, 'root')[0] === 'n', 'node not inserted');
      expect(check, after.version > before.version, 'version did not bump');
    },

    'rejects a transaction as a whole': (create) => {
      const check = 'rejects a transaction as a whole';
      const store = create();
      const before = json(store.getSnapshot());
      let threw = false;
      try {
        store.transact((tx) => {
          tx.setProp('a', ['text'], 'changed');
          tx.removeNode('missing');
        });
      } catch (error) {
        threw = error instanceof TxRejectedError;
      }
      expect(check, threw, 'an invalid write did not throw TxRejectedError');
      expect(
        check,
        json(store.getSnapshot()) === before,
        'the valid write before the invalid one was kept',
      );
      threw = false;
      try {
        store.transact((tx) => {
          tx.setProp('a', ['text'], 'changed');
          throw new Error('caller failed');
        });
      } catch (error) {
        threw = error instanceof TxRejectedError;
      }
      expect(check, threw, 'a throwing callback did not reject');
      expect(
        check,
        json(store.getSnapshot()) === before,
        'a throwing callback left writes behind',
      );
      expect(check, !store.canUndo(), 'a rejected transaction is undoable');
    },

    'passes the origin to subscribers': (create) => {
      const check = 'passes the origin to subscribers';
      const store = create();
      const seen: Origin[] = [];
      const stop = store.subscribe((_changes, origin) => seen.push(origin));
      store.transact((tx) => tx.setProp('a', ['text'], '1'));
      store.transact((tx) => tx.setProp('a', ['text'], '2'), {
        origin: 'remote',
      });
      store.transact((tx) => tx.setProp('a', ['text'], '3'), {
        origin: 'system',
      });
      // The undone write is the latest, so the undo changes the document
      // whether or not the store keeps undo steps after foreign writes.
      store.transact((tx) => tx.setProp('c', ['text'], '4'));
      store.undo();
      stop();
      store.transact((tx) => tx.setProp('a', ['text'], '5'));
      expect(
        check,
        seen.join() === 'local,remote,system,local,history',
        `origins were ${seen.join()}`,
      );
    },

    'names what changed': (create) => {
      const check = 'names what changed';
      const store = create();
      const batches: (readonly Change[])[] = [];
      store.subscribe((changes) => batches.push(changes));
      store.transact((tx) => tx.setProp('a', ['text'], 'x'));
      store.transact((tx) => tx.moveNode('c', 'box', 'children', 0));
      store.transact((tx) => tx.removeNode('a'));
      const has = (i: number, kind: Change['kind'], id: string) =>
        batches[i]?.some((change) => change.kind === kind && change.id === id);
      const props = batches[0]?.find((change) => change.kind === 'props');
      expect(
        check,
        props?.id === 'a' && 'keys' in props && props.keys.includes('text'),
        `setProp reported ${JSON.stringify(batches[0])}`,
      );
      expect(
        check,
        has(1, 'placement', 'c') ||
          has(1, 'placement', 'box') ||
          has(1, 'placement', 'root'),
        `move reported ${JSON.stringify(batches[1])}`,
      );
      expect(
        check,
        has(2, 'node', 'a') || has(2, 'placement', 'root'),
        `remove reported ${JSON.stringify(batches[2])}`,
      );
    },

    'moves a node atomically': (create) => {
      const check = 'moves a node atomically';
      const store = create();
      const count = (state: DocState, id: string) =>
        Object.values(state.nodes).reduce(
          (n, node) =>
            n +
            Object.values(node.slots).filter((ids) => ids.includes(id)).length,
          0,
        );
      let notifications = 0;
      let seenTwice = false;
      store.subscribe(() => {
        notifications += 1;
        if (count(store.getSnapshot(), 'c') !== 1) seenTwice = true;
      });
      store.transact((tx) => tx.moveNode('c', 'box', 'children', 0));
      const after = store.getSnapshot();
      expect(check, notifications === 1, `${notifications} notifications`);
      expect(check, !seenTwice, 'a subscriber saw the node twice or nowhere');
      expect(check, childrenOf(after, 'box')[0] === 'c', 'node not moved');
      expect(
        check,
        after.nodes.c?.parent?.id === 'box',
        'parent pointer not updated',
      );
      let threw = false;
      try {
        store.transact((tx) => tx.moveNode('box', 'b', 'children', 0));
      } catch (error) {
        threw = error instanceof TxRejectedError;
      }
      expect(check, threw, 'a move into the own subtree was accepted');
    },

    'undoes and redoes local writes': (create) => {
      const check = 'undoes and redoes local writes';
      const store = create();
      const initial = json(store.getSnapshot());
      store.transact((tx) => tx.removeNode('box'));
      const removed = json(store.getSnapshot());
      expect(check, store.canUndo(), 'a local write is not undoable');
      const step = store.undo();
      expect(check, step !== null, 'undo returned null');
      expect(
        check,
        json(store.getSnapshot()) === initial,
        'undo did not restore the subtree',
      );
      expect(check, store.canRedo(), 'nothing to redo after undo');
      store.redo();
      expect(check, json(store.getSnapshot()) === removed, 'redo differs');
      store.clearHistory();
      expect(
        check,
        !store.canUndo() && !store.canRedo(),
        'clearHistory left steps',
      );
    },

    'keeps remote, history and ignored writes out of the history': (create) => {
      const check =
        'keeps remote, history and ignored writes out of the history';
      const store = create();
      store.transact((tx) => tx.setProp('a', ['text'], 'r'), {
        origin: 'remote',
      });
      expect(check, !store.canUndo(), 'a remote write is undoable');
      store.transact((tx) => tx.setProp('a', ['text'], 'i'), {
        history: 'ignore',
      });
      expect(check, !store.canUndo(), 'an ignored write is undoable');
      store.transact((tx) => tx.setProp('a', ['text'], 'l'));
      store.undo();
      expect(
        check,
        store.getHistory().past.length === 0,
        'undo added a step to the past',
      );
    },

    'squashes and bails marks': (create) => {
      const check = 'squashes and bails marks';
      const store = create();
      const initial = json(store.getSnapshot());
      const mark = store.mark();
      store.transact((tx) => tx.setProp('a', ['text'], '1'), {
        history: 'ignore',
      });
      store.transact((tx) => tx.setProp('c', ['text'], '2'), {
        history: 'ignore',
      });
      store.squash(mark, { label: 'live' });
      expect(
        check,
        store.getHistory().past.length === 1,
        `squash left ${store.getHistory().past.length} steps`,
      );
      store.undo();
      expect(
        check,
        json(store.getSnapshot()) === initial,
        'undo of the squashed step did not revert both writes',
      );
      const second = store.mark();
      store.transact((tx) => tx.setProp('a', ['text'], 'temp'), {
        history: 'ignore',
      });
      const reverted = store.bail(second);
      expect(check, reverted.length > 0, 'bail returned no ops');
      expect(
        check,
        json(store.getSnapshot()) === initial,
        'bail did not revert',
      );
      expect(check, !store.canUndo(), 'bail left an undo step');
    },

    'merges writes with the same mergeKey': (create) => {
      const check = 'merges writes with the same mergeKey';
      const store = create();
      store.transact((tx) => tx.setProp('a', ['text'], 'A1'), {
        mergeKey: 'a.text',
      });
      store.transact((tx) => tx.setProp('a', ['text'], 'A12'), {
        mergeKey: 'a.text',
      });
      expect(
        check,
        store.getHistory().past.length === 1,
        `${store.getHistory().past.length} steps for one merge key`,
      );
      store.breakMerge();
      store.transact((tx) => tx.setProp('a', ['text'], 'A123'), {
        mergeKey: 'a.text',
      });
      expect(
        check,
        store.getHistory().past.length === 2,
        'breakMerge did not end the merge window',
      );
    },
  };

  const passed: string[] = [];
  for (const [name, run] of Object.entries(checks)) {
    if (
      name === 'merges writes with the same mergeKey' &&
      options.merge === false
    ) {
      continue;
    }
    run(() => createStore(conformanceDocument()));
    passed.push(name);
  }
  return passed;
}

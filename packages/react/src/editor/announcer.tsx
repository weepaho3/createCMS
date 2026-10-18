import * as React from 'react';

import type { FlatNode } from './core/document';
import type { AnnouncedBlock, Messages } from './core/messages';
import type { AnyEditorSchema } from './core/schema';
import type { EditorNodes, EditorStore } from './core/store';

import { useEditorContext } from './context';
import { componentOf } from './core/schema';

/** The latest announcement; a counter makes a repeated text announce again. */
export type Announcer = {
  announce(message: string): void;
  get(): { readonly message: string; readonly seq: number };
  subscribe(listener: () => void): () => void;
};

export function createAnnouncer(): Announcer {
  let state = { message: '', seq: 0 };
  const listeners = new Set<() => void>();
  return {
    announce(message) {
      state = { message, seq: state.seq + 1 };
      for (const listener of listeners) listener();
    },
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const EXCERPT_LENGTH = 40;

/** A block as announcements name it: its type label and its first text, cut to 40 characters. */
export function describeBlock(
  schema: AnyEditorSchema,
  node: FlatNode,
): AnnouncedBlock {
  const label = componentOf(schema, node.type)?.label ?? node.type;
  const text = Object.values(node.props).find(
    (value): value is string =>
      typeof value === 'string' && value.trim() !== '',
  );
  const clean = text?.replace(/<[^>]*>/g, '').trim() ?? '';
  const excerpt =
    clean.length > EXCERPT_LENGTH
      ? `${clean.slice(0, EXCERPT_LENGTH - 1)}…`
      : clean;
  return { label, excerpt };
}

function placeOf(
  schema: AnyEditorSchema,
  nodes: EditorNodes,
  rootId: string,
  id: string,
  messages: Messages,
): { position: number; count: number; parent: string } | null {
  const node = nodes[id];
  if (!node?.parent) return null;
  const siblings = nodes[node.parent.id]?.slots[node.parent.slot] ?? [];
  const parentNode = nodes[node.parent.id];
  const parent =
    node.parent.id === rootId || !parentNode
      ? messages.announce.root
      : describeBlock(schema, parentNode).label;
  return { position: siblings.indexOf(id) + 1, count: siblings.length, parent };
}

/**
 * Announces structural changes (insert, move, remove, undo, redo) and inline
 * editing start and end, one message per change, with texts from the
 * catalog. Returns a function that stops it.
 */
export function startAnnouncing(
  store: EditorStore,
  announcer: Announcer,
  messages: Messages,
): () => void {
  const schema = store.schema;
  let previous = store.getDoc().nodes;
  let editing = store.getSession().editing;

  const offChange = store.on('change', (change) => {
    const { nodes, rootId } = store.getDoc();
    const before = previous;
    previous = nodes;
    if (change.origin !== 'local') return;
    for (const op of change.ops) {
      if (op.op === 'insert') {
        const node = nodes[op.node.id];
        const place = placeOf(schema, nodes, rootId, op.node.id, messages);
        if (node && place) {
          announcer.announce(
            messages.announce.inserted({
              block: describeBlock(schema, node),
              ...place,
            }),
          );
        }
        return;
      }
      if (op.op === 'move') {
        const node = nodes[op.id];
        const place = placeOf(schema, nodes, rootId, op.id, messages);
        if (node && place) {
          announcer.announce(
            messages.announce.moved({
              block: describeBlock(schema, node),
              ...place,
            }),
          );
        }
        return;
      }
      if (op.op === 'remove') {
        const node = before[op.id];
        if (node) {
          announcer.announce(
            messages.announce.removed({ block: describeBlock(schema, node) }),
          );
        }
        return;
      }
    }
  });
  const offHistory = store.on('history', ({ direction, label }) => {
    announcer.announce(
      direction === 'undo'
        ? messages.announce.undone({ label })
        : messages.announce.redone({ label }),
    );
  });
  // A local edit the schema or placement rules refused (a paste of a type
  // the slot does not take, a drop on the wrong slot).
  const offRejected = store.on('opRejected', ({ origin }) => {
    if (origin === 'local') announcer.announce(messages.announce.refused);
  });
  const offSession = store.subscribeSession(() => {
    const next = store.getSession().editing;
    if (next === editing) return;
    const was = editing;
    editing = next;
    const ref = next ?? was;
    const node = ref ? store.getDoc().nodes[ref.blockId] : undefined;
    if (!ref || !node) return;
    const field =
      componentOf(schema, node.type)?.fields[ref.key]?.label ?? ref.key;
    const block = describeBlock(schema, node);
    announcer.announce(
      next
        ? messages.announce.editingStarted({ block, field })
        : messages.announce.editingEnded({ block, field }),
    );
  });
  return () => {
    offChange();
    offHistory();
    offRejected();
    offSession();
  };
}

const VISUALLY_HIDDEN: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

export type EditorLiveAnnouncerProps = Omit<
  React.ComponentPropsWithoutRef<'div'>,
  'children'
>;

/**
 * A visually hidden `aria-live="polite"` region that speaks the editor's
 * announcements. Render one per editor.
 */
export function EditorLiveAnnouncer({
  style,
  ...rest
}: EditorLiveAnnouncerProps) {
  const { announcer } = useEditorContext('Editor.LiveAnnouncer');
  const { message, seq } = React.useSyncExternalStore(
    announcer.subscribe,
    announcer.get,
    announcer.get,
  );
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-editor-live-announcer=""
      style={{ ...VISUALLY_HIDDEN, ...style }}
      {...rest}
    >
      {/* The key re-mounts the text, so a repeated message is spoken again. */}
      <span key={seq}>{message}</span>
    </div>
  );
}

/** Announces a message through the editor's live region. */
export function useAnnounce(): (message: string) => void {
  return useEditorContext('useAnnounce').announcer.announce;
}

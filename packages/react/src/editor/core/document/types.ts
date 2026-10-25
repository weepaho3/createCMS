/** Any value that survives `JSON.stringify` / `JSON.parse` unchanged. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * One node of the nested wire format: what is persisted, exchanged and
 * rendered.
 *
 * @example
 * const hero: NodeData = {
 *   id: 'blk_1',
 *   type: 'hero',
 *   props: { title: 'Hello' },
 *   slots: { children: [{ id: 'blk_2', type: 'button', props: {} }] },
 * };
 */
export type NodeData = {
  /** Opaque, client-generated, globally unique. */
  id: string;
  type: string;
  /** Schema version of this node's component, read by migrations. */
  v?: number;
  /** Field values; may hold `$r`/`$l` wrappers and rich text documents. */
  props: Record<string, JsonValue>;
  /** Named slots, each an ordered list of child nodes. */
  slots?: Record<string, NodeData[]>;
  /** Adapter-owned data the editor carries along and never reads. */
  meta?: Record<string, JsonValue>;
};

/** A whole document. `root.type` is `'root'`. */
export type EditorDocument = { schemaVersion: number; root: NodeData };

/** Where a node sits: its parent and the parent's slot. */
export type SlotRef = { id: string; slot: string };

/**
 * One node of the flat in-memory form. `parent` is `null` only for the root;
 * `slots` holds child ids in order.
 */
export type FlatNode = {
  id: string;
  type: string;
  v?: number;
  props: Record<string, JsonValue>;
  parent: SlotRef | null;
  slots: Record<string, string[]>;
  meta?: Record<string, JsonValue>;
};

/** A document in flat form: every node keyed by id. */
export type NormalizedDoc = {
  rootId: string;
  nodes: Record<string, FlatNode>;
};

/**
 * Who caused an op: the local user, a collaborator, undo/redo, or the editor
 * itself (load, repair, migration).
 */
export type Origin = 'local' | 'remote' | 'history' | 'system';

/**
 * One serialisable change to a document. `update` is a merge patch: a `null`
 * value deletes the key. `replace` swaps the whole document.
 */
export type Op =
  | { op: 'insert'; parent: SlotRef; index: number; node: NodeData }
  | { op: 'remove'; id: string }
  | { op: 'move'; id: string; parent: SlotRef; index: number }
  | { op: 'update'; id: string; patch: Record<string, JsonValue | null> }
  | { op: 'replace'; doc: EditorDocument };

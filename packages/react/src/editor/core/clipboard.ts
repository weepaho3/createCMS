import type { JsonValue, NodeData } from './document';
import type { EditorCommand, EditorStore, SlotTarget } from './store';

import { EN_MESSAGES } from './messages';
import { DEFAULT_SLOT, slotsOf } from './schema';
import { serializeSubtree } from './store/serde';

export const CLIPBOARD_APP = 'createcms-editor';
export const CLIPBOARD_VERSION = 1;
/** The custom clipboard format, written only where `ClipboardItem.supports` accepts it. */
export const CLIPBOARD_MIME = 'web application/x-createcms-editor+json';
/** The attribute that carries the payload inside copied `text/html`. */
export const CLIPBOARD_ATTRIBUTE = 'data-editor-clipboard';

/** What the editor puts on the clipboard: whole blocks, or one block's props. */
export type ClipboardPayload =
  | {
      readonly app: typeof CLIPBOARD_APP;
      readonly version: number;
      readonly kind: 'blocks';
      readonly blocks: readonly NodeData[];
    }
  | {
      readonly app: typeof CLIPBOARD_APP;
      readonly version: number;
      readonly kind: 'props';
      readonly type: string;
      readonly props: Readonly<Record<string, JsonValue>>;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isNodeData(value: unknown, depth = 0): value is NodeData {
  if (depth > 200 || !isRecord(value)) return false;
  if (typeof value.id !== 'string' || typeof value.type !== 'string') {
    return false;
  }
  if (!isRecord(value.props)) return false;
  if (value.slots === undefined) return true;
  if (!isRecord(value.slots)) return false;
  return Object.values(value.slots).every(
    (children) =>
      Array.isArray(children) &&
      children.every((child) => isNodeData(child, depth + 1)),
  );
}

/** `value` when it is a well-formed payload of this editor, else `null`. */
export function parseClipboardPayload(value: unknown): ClipboardPayload | null {
  if (!isRecord(value) || value.app !== CLIPBOARD_APP) return null;
  if (value.version !== CLIPBOARD_VERSION) return null;
  if (value.kind === 'blocks') {
    const blocks = value.blocks;
    if (!Array.isArray(blocks) || blocks.length === 0) return null;
    return blocks.every((block) => isNodeData(block))
      ? (value as ClipboardPayload)
      : null;
  }
  if (value.kind === 'props') {
    return typeof value.type === 'string' && isRecord(value.props)
      ? (value as ClipboardPayload)
      : null;
  }
  return null;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): string | null {
  try {
    const binary = atob(text);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * `text/html` that carries `payload` in an attribute, around a readable
 * fallback (`text`), so it survives every engine's clipboard and pastes
 * as plain text elsewhere.
 */
export function encodeClipboardHtml(
  payload: ClipboardPayload,
  text = '',
): string {
  const data = toBase64(JSON.stringify(payload));
  return `<div ${CLIPBOARD_ATTRIBUTE}="${data}">${escapeHtml(text)}</div>`;
}

/** The payload from the custom format or from copied `text/html`, else `null`. */
export function decodeClipboard(input: {
  json?: string | null;
  html?: string | null;
}): ClipboardPayload | null {
  const parse = (json: string | null): ClipboardPayload | null => {
    if (json === null) return null;
    try {
      return parseClipboardPayload(JSON.parse(json));
    } catch {
      return null;
    }
  };
  if (input.json) {
    const payload = parse(input.json);
    if (payload) return payload;
  }
  const match = input.html?.match(
    new RegExp(`${CLIPBOARD_ATTRIBUTE}="([A-Za-z0-9+/=]+)"`),
  );
  return match?.[1] ? parse(fromBase64(match[1])) : null;
}

/** Selected ids without those inside another selected block, in document order. */
function topLevelSelection(store: EditorStore): string[] {
  const { nodes, rootId } = store.getDoc();
  const selected = new Set(
    store.getSession().selection.filter((id) => id !== rootId && id in nodes),
  );
  const out: string[] = [];
  const order = (type: string) => Object.keys(slotsOf(store.schema, type));
  const walk = (id: string): void => {
    const node = nodes[id];
    if (!node) return;
    if (selected.has(id)) {
      out.push(id);
      return;
    }
    const slots = [
      ...new Set([...order(node.type), ...Object.keys(node.slots)]),
    ];
    for (const slot of slots) {
      for (const child of node.slots[slot] ?? []) walk(child);
    }
  };
  walk(rootId);
  return out;
}

/** The selected blocks (outermost only) as a payload, or `null` without a selection. */
export function copyBlocks(store: EditorStore): ClipboardPayload | null {
  const ids = topLevelSelection(store);
  if (ids.length === 0) return null;
  const { nodes } = store.getDoc();
  const order = (type: string) => Object.keys(slotsOf(store.schema, type));
  return {
    app: CLIPBOARD_APP,
    version: CLIPBOARD_VERSION,
    kind: 'blocks',
    blocks: ids.map((id) => serializeSubtree(nodes, id, order)),
  };
}

/** The primary selected block's props, or `null`. */
export function copyProps(store: EditorStore): ClipboardPayload | null {
  const [id] = store.getSession().selection;
  const node = id === undefined ? undefined : store.getDoc().nodes[id];
  if (!node || node.parent === null) return null;
  return {
    app: CLIPBOARD_APP,
    version: CLIPBOARD_VERSION,
    kind: 'props',
    type: node.type,
    props: node.props as Record<string, JsonValue>,
  };
}

/** Removes the selected blocks in one undo step (the cut half of cut). */
export function removeSelected(store: EditorStore): boolean {
  const ids = topLevelSelection(store);
  if (ids.length === 0) return false;
  return store.transact(() => {
    for (const id of ids) store.remove(id);
  }).ok;
}

/**
 * Where pasted blocks go: into the selected block when its first slot is
 * empty, else right after the primary selection, else at the end of the
 * root.
 */
export function pasteTarget(store: EditorStore): {
  parent: SlotTarget;
  index?: number;
} {
  const { nodes, rootId } = store.getDoc();
  const [id] = store.getSession().selection;
  const node = id === undefined ? undefined : nodes[id];
  if (node) {
    const slot = Object.keys(slotsOf(store.schema, node.type))[0];
    if (slot !== undefined && (node.slots[slot]?.length ?? 0) === 0) {
      return { parent: { id: node.id, slot } };
    }
    if (node.parent !== null) {
      const siblings = nodes[node.parent.id]?.slots[node.parent.slot] ?? [];
      return { parent: node.parent, index: siblings.indexOf(node.id) + 1 };
    }
  }
  return { parent: { id: rootId, slot: DEFAULT_SLOT } };
}

/**
 * Inserts a payload's blocks with fresh ids where `pasteTarget` points, as
 * one undo step that the schema and placement rules check; selects the
 * copies. Returns their ids, empty when the paste was refused (the store
 * emits `opRejected`).
 */
export function pasteBlocks(
  store: EditorStore,
  payload: ClipboardPayload,
): string[] {
  if (payload.kind !== 'blocks') return [];
  const target = pasteTarget(store);
  const result = store.dispatch({
    type: 'node.paste',
    payload: { ...target, nodes: payload.blocks },
  });
  if (!result.ok) return [];
  return result.ops.flatMap((op) => (op.op === 'insert' ? [op.node.id] : []));
}

/** Applies copied props to the selected blocks of the same type. */
export function pasteProps(
  store: EditorStore,
  payload: ClipboardPayload,
): boolean {
  if (payload.kind !== 'props') return false;
  const { nodes } = store.getDoc();
  const targets = store
    .getSession()
    .selection.filter((id) => nodes[id]?.type === payload.type);
  if (targets.length === 0) return false;
  return store.transact(() => {
    for (const id of targets) store.update(id, { ...payload.props });
  }).ok;
}

/** Readable text of copied blocks: their string props, depth first. */
export function plainTextOf(blocks: readonly NodeData[]): string {
  const lines: string[] = [];
  const walk = (node: NodeData): void => {
    for (const value of Object.values(node.props)) {
      if (typeof value === 'string' && value.trim() !== '') lines.push(value);
    }
    for (const children of Object.values(node.slots ?? {})) {
      for (const child of children) walk(child);
    }
  };
  for (const block of blocks) walk(block);
  return lines.join('\n');
}

type ClipboardItemLike = {
  readonly types: readonly string[];
  getType(type: string): Promise<Blob>;
};
type ClipboardItemCtor = {
  new (items: Record<string, Blob>): unknown;
  supports?(type: string): boolean;
};
type AsyncClipboard = {
  write?(items: unknown[]): Promise<void>;
  read?(): Promise<ClipboardItemLike[]>;
};

const asyncClipboard = (): AsyncClipboard | undefined =>
  (globalThis as { navigator?: { clipboard?: AsyncClipboard } }).navigator
    ?.clipboard;

/**
 * Writes a payload through the async Clipboard API: `text/html` with the
 * embedded payload, `text/plain`, and the custom format where the engine
 * supports it. Resolves `false` without the API or permission.
 */
export async function writeClipboard(
  payload: ClipboardPayload,
): Promise<boolean> {
  const clipboard = asyncClipboard();
  const Item = (globalThis as { ClipboardItem?: ClipboardItemCtor })
    .ClipboardItem;
  if (!clipboard?.write || !Item) return false;
  const text = payload.kind === 'blocks' ? plainTextOf(payload.blocks) : '';
  const items: Record<string, Blob> = {
    'text/html': new Blob([encodeClipboardHtml(payload, text)], {
      type: 'text/html',
    }),
    'text/plain': new Blob([text], { type: 'text/plain' }),
  };
  if (Item.supports?.(CLIPBOARD_MIME)) {
    items[CLIPBOARD_MIME] = new Blob([JSON.stringify(payload)], {
      type: CLIPBOARD_MIME,
    });
  }
  try {
    await clipboard.write([new Item(items)]);
    return true;
  } catch {
    return false;
  }
}

/** Reads a payload through the async Clipboard API, or `null`. */
export async function readClipboard(): Promise<ClipboardPayload | null> {
  const clipboard = asyncClipboard();
  if (!clipboard?.read) return null;
  try {
    for (const item of await clipboard.read()) {
      const text = async (type: string) =>
        item.types.includes(type) ? (await item.getType(type)).text() : null;
      const payload = decodeClipboard({
        json: await text(CLIPBOARD_MIME),
        html: await text('text/html'),
      });
      if (payload) return payload;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * The clipboard commands. Copy, cut and paste are `native`: from the
 * keyboard the browser's own clipboard events run them (see
 * `bindEditorClipboard`); a menu or button runs them through the async
 * Clipboard API. The last copy is also kept in memory, so paste works in
 * the same editor without clipboard permission.
 */
export function clipboardCommands(): EditorCommand[] {
  let blocks: ClipboardPayload | null = null;
  let props: ClipboardPayload | null = null;
  const hasSelection = (s: EditorStore) =>
    s.getSession().selection.some((id) => id !== s.getDoc().rootId);
  const copy = (s: EditorStore): ClipboardPayload | null => {
    const payload = copyBlocks(s);
    if (!payload) return null;
    blocks = payload;
    void writeClipboard(payload);
    return payload;
  };
  return [
    {
      id: 'clipboard.copy',
      label: EN_MESSAGES.commands['clipboard.copy'],
      native: true,
      run: (s) => copy(s) !== null,
      canExecute: hasSelection,
    },
    {
      id: 'clipboard.cut',
      label: EN_MESSAGES.commands['clipboard.cut'],
      native: true,
      run: (s) => copy(s) !== null && removeSelected(s),
      canExecute: hasSelection,
    },
    {
      id: 'clipboard.paste',
      label: EN_MESSAGES.commands['clipboard.paste'],
      native: true,
      run: async (s) => {
        const payload = (await readClipboard()) ?? blocks;
        return payload ? pasteBlocks(s, payload) : [];
      },
    },
    {
      id: 'clipboard.copyProps',
      label: EN_MESSAGES.commands['clipboard.copyProps'],
      run: (s) => {
        props = copyProps(s);
        if (props) void writeClipboard(props);
        return props !== null;
      },
      canExecute: (s) => copyProps(s) !== null,
    },
    {
      id: 'clipboard.pasteProps',
      label: EN_MESSAGES.commands['clipboard.pasteProps'],
      run: (s) => (props ? pasteProps(s, props) : false),
      canExecute: (s) => {
        if (props?.kind !== 'props') return false;
        const { nodes } = s.getDoc();
        const type = props.type;
        return s.getSession().selection.some((id) => nodes[id]?.type === type);
      },
    },
  ];
}

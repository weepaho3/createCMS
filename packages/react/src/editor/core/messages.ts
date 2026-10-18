import type { JsonValue } from './document';
import type {
  FieldError,
  FieldErrorCode,
  StructureErrorCode,
  ValidationIssue,
} from './schema';

type Params = Readonly<Record<string, JsonValue | undefined>>;

/** A block as announcements name it: its type label plus a text excerpt. */
export type AnnouncedBlock = {
  readonly label: string;
  readonly excerpt: string;
};

/**
 * Every text the editor shows. Validation and announcement entries are
 * functions of their parameters; schema labels stay content and are not part
 * of the catalog.
 */
export type Messages = {
  readonly field: {
    readonly [K in FieldErrorCode]: (params: Params) => string;
  };
  readonly structure: {
    readonly [K in StructureErrorCode]: (params: Params) => string;
  };
  /** A Standard Schema finding; `message` is the validator's own text. */
  readonly schema: (params: Params) => string;
  readonly parts: {
    readonly dragHandle: string;
    readonly inlineText: string;
    readonly framePreview: string;
    readonly blockError: (p: { type: string; id: string }) => string;
    readonly unknownBlock: (p: { type: string }) => string;
    readonly listAdd: (p: { label: string }) => string;
    readonly listAddText: string;
    readonly listRemove: (p: { label: string; position: number }) => string;
    readonly listRemoveText: string;
    readonly listMoveUp: (p: { label: string; position: number }) => string;
    readonly listMoveUpText: string;
    readonly listMoveDown: (p: { label: string; position: number }) => string;
    readonly listMoveDownText: string;
    readonly errorSummaryTitle: (p: { count: number }) => string;
    readonly shortcutsTitle: string;
    readonly shortcutsClose: string;
    readonly blockToolbar: (p: { label: string }) => string;
    readonly outline: string;
    readonly contextMenu: string;
    readonly contextSelect: (p: { block: AnnouncedBlock }) => string;
    readonly contextSelectBelow: (p: { block: AnnouncedBlock }) => string;
  };
  /** Labels of the built-in UI commands, by command id. */
  readonly commands: Readonly<Record<string, string>>;
  readonly announce: {
    readonly inserted: (p: {
      block: AnnouncedBlock;
      position: number;
      count: number;
      parent: string;
    }) => string;
    readonly moved: (p: {
      block: AnnouncedBlock;
      position: number;
      count: number;
      parent: string;
    }) => string;
    readonly removed: (p: { block: AnnouncedBlock }) => string;
    readonly undone: (p: { label: string | undefined }) => string;
    readonly redone: (p: { label: string | undefined }) => string;
    readonly editingStarted: (p: {
      block: AnnouncedBlock;
      field: string;
    }) => string;
    readonly editingEnded: (p: {
      block: AnnouncedBlock;
      field: string;
    }) => string;
    readonly root: string;
    /** A local edit the schema or placement rules refused. */
    readonly refused: string;
    readonly dragPickedUp: (p: {
      block: AnnouncedBlock;
      position: number;
      count: number;
      parent: string;
    }) => string;
    readonly dragMoved: (p: {
      position: number;
      count: number;
      parent: string;
    }) => string;
    readonly dragDropped: (p: {
      block: AnnouncedBlock;
      position: number;
      parent: string;
    }) => string;
    readonly dragCancelled: (p: {
      block: AnnouncedBlock;
      position: number;
      count: number;
      parent: string;
    }) => string;
    /** The dragged block was removed by someone else. */
    readonly dragSourceRemoved: string;
    /** A keyboard drag found no other place the block may go. */
    readonly dragNoTargets: string;
  };
  /** Key names for shortcut labels; `apple` platforms show symbols. */
  readonly keys: {
    readonly apple: KeyNames;
    readonly other: KeyNames;
  };
};

export type KeyNames = {
  readonly mod: string;
  readonly ctrl: string;
  readonly alt: string;
  readonly shift: string;
  /** Between keys (`+`, or `''` for symbols). */
  readonly separator: string;
};

const value = (params: Params, key: string, fallback = ''): string => {
  const v = params[key];
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  return v === undefined ? fallback : JSON.stringify(v);
};

const named = (block: AnnouncedBlock): string =>
  block.excerpt ? `${block.label} "${block.excerpt}"` : block.label;

/** The built-in English catalog. */
export const EN_MESSAGES: Messages = {
  field: {
    required: () => 'This field is required.',
    type: (p) => `Must be ${value(p, 'expected', 'a valid value')}.`,
    format: () => 'Must be an ISO-8601 datetime (UTC).',
    minLength: (p) => `Must be at least ${value(p, 'min')} characters.`,
    maxLength: (p) => `Must be at most ${value(p, 'max')} characters.`,
    pattern: () => 'Has an invalid format.',
    min: (p) => `Must be at least ${value(p, 'min')}.`,
    max: (p) => `Must be at most ${value(p, 'max')}.`,
    step: (p) => `Must be a multiple of ${value(p, 'step')}.`,
    minItems: (p) => `Must have at least ${value(p, 'min')} item(s).`,
    maxItems: (p) => `Must have at most ${value(p, 'max')} item(s).`,
    option: () => 'Must be one of the options.',
    linkKind: () => 'This link kind is not allowed.',
    linkCollection: () => 'Links to this collection are not allowed.',
    linkTarget: () => 'The link needs a target.',
    responsive: () => 'This field has no per-breakpoint values.',
    localized: () => 'This field has no per-locale values.',
  },
  structure: {
    duplicateId: () => 'This block id is used twice.',
    unknownType: (p) => `Unknown block type "${value(p, 'type')}".`,
    unknownSlot: () => 'This slot is not declared for the block type.',
    placement: (p) =>
      `A ${value(p, 'type', 'block')} cannot go into this slot.`,
    slotMin: (p) => `Needs at least ${value(p, 'min')} block(s).`,
    slotMax: (p) => `Takes at most ${value(p, 'max')} block(s).`,
  },
  schema: (p) => value(p, 'message', 'Has an invalid value.'),
  parts: {
    dragHandle: 'Drag to move',
    inlineText: 'Edit text',
    framePreview: 'Preview',
    blockError: (p) => `${p.type} (${p.id}) failed to render`,
    unknownBlock: (p) => `Unknown block type "${p.type}"`,
    listAdd: (p) => `Add ${p.label}`,
    listAddText: 'Add',
    listRemove: (p) => `Remove ${p.label} ${p.position}`,
    listRemoveText: 'Remove',
    listMoveUp: (p) => `Move ${p.label} ${p.position} up`,
    listMoveUpText: 'Move up',
    listMoveDown: (p) => `Move ${p.label} ${p.position} down`,
    listMoveDownText: 'Move down',
    errorSummaryTitle: (p) =>
      p.count === 1 ? '1 problem to fix' : `${p.count} problems to fix`,
    shortcutsTitle: 'Keyboard shortcuts',
    shortcutsClose: 'Close',
    blockToolbar: (p) => `${p.label} actions`,
    outline: 'Page structure',
    contextMenu: 'Block actions',
    contextSelect: (p) => `Select ${named(p.block)}`,
    contextSelectBelow: (p) => `Select layer below: ${named(p.block)}`,
  },
  commands: {
    'history.undo': 'Undo',
    'history.redo': 'Redo',
    'block.remove': 'Delete',
    'block.duplicate': 'Duplicate',
    'block.moveUp': 'Move up',
    'block.moveDown': 'Move down',
    'block.wrap': 'Wrap in container',
    'selection.parent': 'Select parent',
    'selection.firstChild': 'Select first child',
    'selection.next': 'Select next',
    'selection.previous': 'Select previous',
    'selection.siblings': 'Select all siblings',
    'clipboard.copy': 'Copy',
    'clipboard.cut': 'Cut',
    'clipboard.paste': 'Paste',
    'clipboard.copyProps': 'Copy properties',
    'clipboard.pasteProps': 'Paste properties',
    'ui.commandPalette': 'Command palette',
    'ui.quickInsert': 'Quick insert',
    'ui.toolbar': 'Focus block toolbar',
    'ui.shortcutHelp': 'Keyboard shortcuts',
  },
  announce: {
    inserted: (p) =>
      `${named(p.block)} added at position ${p.position} of ${p.count} in ${p.parent}.`,
    moved: (p) =>
      `${named(p.block)} moved to position ${p.position} of ${p.count} in ${p.parent}.`,
    removed: (p) => `${named(p.block)} removed.`,
    undone: (p) => (p.label ? `Undone: ${p.label}.` : 'Undone.'),
    redone: (p) => (p.label ? `Redone: ${p.label}.` : 'Redone.'),
    editingStarted: (p) => `Editing ${p.field} of ${named(p.block)}.`,
    editingEnded: (p) => `Stopped editing ${p.field}.`,
    root: 'the page',
    refused: 'That cannot go here.',
    dragPickedUp: (p) =>
      `${named(p.block)} picked up. Position ${p.position} of ${p.count} in ${p.parent}.`,
    dragMoved: (p) =>
      `Moved to ${p.parent}, position ${p.position} of ${p.count}.`,
    dragDropped: (p) =>
      `${named(p.block)} dropped in ${p.parent}, position ${p.position}.`,
    dragCancelled: (p) =>
      `Cancelled. ${named(p.block)} back at position ${p.position} of ${p.count} in ${p.parent}.`,
    dragSourceRemoved: 'Drag cancelled: the block was removed.',
    dragNoTargets: 'There is no other place this block can go.',
  },
  keys: {
    apple: { mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧', separator: '' },
    other: {
      mod: 'Ctrl',
      ctrl: 'Ctrl',
      alt: 'Alt',
      shift: 'Shift',
      separator: '+',
    },
  },
};

/** A partial catalog: any subset of entries, nested. */
export type MessagesInput = {
  readonly [K in keyof Messages]?: Messages[K] extends (
    ...args: never[]
  ) => unknown
    ? Messages[K]
    : Messages[K] extends Readonly<Record<string, unknown>>
      ? {
          readonly [P in keyof Messages[K]]?: Messages[K][P] extends Readonly<
            Record<string, unknown>
          >
            ? Partial<Messages[K][P]>
            : Messages[K][P];
        }
      : Messages[K];
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, next] of Object.entries(patch)) {
    if (next === undefined) continue;
    const current = out[key];
    out[key] =
      isPlainObject(current) && isPlainObject(next)
        ? deepMerge(current, next)
        : next;
  }
  return out;
}

/** `base` with each partial catalog merged in, later ones winning. */
export function mergeMessages(
  base: Messages,
  ...patches: readonly (MessagesInput | undefined)[]
): Messages {
  let out: Record<string, unknown> = { ...base };
  for (const patch of patches) {
    if (patch) out = deepMerge(out, { ...patch });
  }
  // Every patch only replaces entries of `base` with values of their type.
  return out as Messages;
}

/** One finding as text, from the catalog. */
export function formatIssue(
  issue: FieldError | ValidationIssue,
  messages: Messages = EN_MESSAGES,
): string {
  const params: Params = issue.params ?? {};
  const code = issue.code;
  if (code === 'schema') return messages.schema(params);
  if (code in messages.structure) {
    return messages.structure[code as StructureErrorCode](params);
  }
  return messages.field[code as FieldErrorCode](params);
}

export type Platform = 'apple' | 'other';

/** `apple` on macOS and iOS, `other` elsewhere (and outside a browser). */
export function detectPlatform(): Platform {
  const nav = (
    globalThis as { navigator?: { platform?: string; userAgent?: string } }
  ).navigator;
  const hint = `${nav?.platform ?? ''} ${nav?.userAgent ?? ''}`;
  return /Mac|iPhone|iPad|iPod/.test(hint) ? 'apple' : 'other';
}

const NAMED_KEYS: Readonly<Record<string, string>> = {
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  escape: 'Escape',
  enter: 'Enter',
  tab: 'Tab',
  delete: 'Delete',
  backspace: 'Backspace',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
};

const KEY_SYMBOLS: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
};

/** The `KeyboardEvent.key` spelling of a combo's key (`F10`, `ArrowUp`, `Z`). */
function keyName(key: string): string {
  if (key.length === 1) return key.toUpperCase();
  const lower = key.toLowerCase();
  if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase();
  return NAMED_KEYS[lower] ?? key;
}

function parts(combo: string): { mods: string[]; key: string } {
  const all = combo.split('+').map((part) => part.trim());
  const key = all.pop() ?? '';
  return { mods: all.map((m) => m.toLowerCase()), key };
}

/** `Mod+Shift+z` as a label: `⌘⇧Z` on Apple platforms, `Ctrl+Shift+Z` elsewhere. */
export function formatShortcut(
  combo: string,
  options: { platform?: Platform; messages?: Messages } = {},
): string {
  const platform = options.platform ?? detectPlatform();
  const names = (options.messages ?? EN_MESSAGES).keys[platform];
  const { mods, key } = parts(combo);
  const labels = mods.map((mod) => {
    if (mod === 'mod' || mod === 'meta' || mod === 'cmd') return names.mod;
    if (mod === 'ctrl') return names.ctrl;
    if (mod === 'alt') return names.alt;
    if (mod === 'shift') return names.shift;
    return mod;
  });
  const name = keyName(key);
  return [...labels, KEY_SYMBOLS[name] ?? name].join(names.separator);
}

/** `Mod+Shift+z` as an `aria-keyshortcuts` value (`Meta+Shift+Z` or `Control+Shift+Z`). */
export function ariaKeyShortcut(
  combo: string,
  platform: Platform = detectPlatform(),
): string {
  const { mods, key } = parts(combo);
  const names = mods.map((mod) => {
    if (mod === 'mod' || mod === 'meta' || mod === 'cmd') {
      return platform === 'apple' ? 'Meta' : 'Control';
    }
    if (mod === 'ctrl') return 'Control';
    if (mod === 'alt') return 'Alt';
    if (mod === 'shift') return 'Shift';
    return mod;
  });
  return [...names, keyName(key)].join('+');
}

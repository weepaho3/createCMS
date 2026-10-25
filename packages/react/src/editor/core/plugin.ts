import type { NodeData } from './document';
import type { MessagesInput } from './messages';
import type {
  AnyComponentDef,
  AnyEditorSchema,
  Field,
  StandardSchemaV1,
} from './schema';
import type {
  BeforeCommandHandler,
  BeforeSaveGate,
  EditorCommand,
  EditorEventName,
  EditorEvents,
  EditorStore,
} from './store/types';

import { formatEditorMessage } from './codes';

/** What a plugin contributes for one `custom` field kind. */
export type PluginFieldKind = {
  /** Validates values of `custom` fields of this kind that declare no `schema`. */
  validate?: StandardSchemaV1;
  /** The form control; typed by the rendering layer (`/editor`). */
  control?: unknown;
};

/** A UI command a plugin adds (toolbar, palette, shortcut target). */
export type PluginCommand = {
  label?: string;
  run(store: EditorStore, args?: unknown): unknown;
  canExecute?(store: EditorStore, args?: unknown): boolean;
};

export type PluginEventHandlers = {
  [E in EditorEventName]?: (payload: EditorEvents[E]) => void;
} & {
  /** Runs before middlewares: `false` cancels, a command replaces it. */
  beforeCommand?: BeforeCommandHandler;
};

/**
 * One editor extension: field kinds, blocks, commands, shortcuts, event
 * handlers, UI slot contributions. Plugins apply in descending `priority`,
 * ties in the order given.
 */
export type EditorPlugin = {
  /** Unique across the plugins of one editor. */
  readonly name: string;
  readonly fields?: Readonly<Record<string, PluginFieldKind>>;
  /** Components added to the schema; a schema component of the same type wins. */
  readonly blocks?: Readonly<Record<string, AnyComponentDef>>;
  /** UI commands by id. */
  readonly commands?: Readonly<Record<string, PluginCommand>>;
  /** Key combo (`Mod+Shift+d`) to command id; replaces a default binding, `''` unbinds it. */
  readonly shortcuts?: Readonly<Record<string, string>>;
  readonly on?: PluginEventHandlers;
  /** Components for named UI outlets (`block-toolbar`, ...); typed by the rendering layer. */
  readonly slots?: Readonly<Record<string, unknown>>;
  /** Catalog entries (command labels, texts); `Editor.Root`'s `messages` win. */
  readonly messages?: MessagesInput;
  /** Blocks a save with issues (after `Editor.Root`'s `beforeSave`). */
  readonly beforeSave?: BeforeSaveGate;
  /**
   * Turns pasted content from outside the editor (`text/html`,
   * `text/plain`) into blocks; the first plugin that returns blocks wins.
   * Ids are replaced on insert.
   */
  readonly convertForeignPaste?: (
    data: { readonly html: string; readonly text: string },
    store: EditorStore,
  ) => readonly NodeData[] | null | undefined;
  readonly priority?: number;
};

/** Declares a plugin and keeps its literal type. */
export function defineEditorPlugin<const P extends EditorPlugin>(plugin: P): P {
  return plugin;
}

/**
 * The plugins in apply order (descending `priority`, stable). Throws on a
 * duplicate `name`.
 */
export function sortPlugins(
  plugins: readonly EditorPlugin[],
): readonly EditorPlugin[] {
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (seen.has(plugin.name)) {
      throw new Error(
        formatEditorMessage('E002', `duplicate plugin name "${plugin.name}"`),
      );
    }
    seen.add(plugin.name);
  }
  return plugins
    .map((plugin, index) => ({ plugin, index }))
    .sort(
      (a, b) =>
        (b.plugin.priority ?? 0) - (a.plugin.priority ?? 0) ||
        a.index - b.index,
    )
    .map((entry) => entry.plugin);
}

function withKinds(
  fields: Record<string, Field>,
  kinds: ReadonlyMap<string, PluginFieldKind>,
): Record<string, Field> {
  let changed = false;
  const out: Record<string, Field> = {};
  for (const [key, field] of Object.entries(fields)) {
    let next: Field = field;
    if (field.type === 'custom' && field.schema === undefined) {
      const schema = kinds.get(field.kind)?.validate;
      if (schema) next = { ...field, schema };
    } else if (field.type === 'object') {
      const nested = withKinds(field.fields, kinds);
      if (nested !== field.fields) next = { ...field, fields: nested };
    } else if (field.type === 'list') {
      const [of] = Object.values(withKinds({ of: field.of }, kinds));
      if (of && of !== field.of) next = { ...field, of };
    }
    if (next !== field) changed = true;
    out[key] = next;
  }
  return changed ? out : fields;
}

function componentWithKinds(
  def: AnyComponentDef,
  kinds: ReadonlyMap<string, PluginFieldKind>,
): AnyComponentDef {
  const fields = withKinds(def.fields, kinds);
  return fields === def.fields ? def : { ...def, fields };
}

/**
 * The schema with the plugins' blocks added (schema components win) and
 * their field kinds' validators set on `custom` fields without a `schema`.
 * Returns `schema` itself when no plugin contributes either.
 */
export function applyPlugins(
  schema: AnyEditorSchema,
  plugins: readonly EditorPlugin[],
): AnyEditorSchema {
  const kinds = new Map<string, PluginFieldKind>();
  const blocks: Record<string, AnyComponentDef> = {};
  for (const plugin of sortPlugins(plugins)) {
    for (const [kind, def] of Object.entries(plugin.fields ?? {})) {
      if (!kinds.has(kind)) kinds.set(kind, def);
    }
    for (const [type, def] of Object.entries(plugin.blocks ?? {})) {
      if (!(type in blocks)) blocks[type] = def;
    }
  }
  if (kinds.size === 0 && Object.keys(blocks).length === 0) return schema;
  const components: Record<string, AnyComponentDef> = {};
  for (const [type, def] of Object.entries({
    ...blocks,
    ...schema.components,
  })) {
    components[type] = componentWithKinds(def, kinds);
  }
  return {
    ...schema,
    root: componentWithKinds(schema.root, kinds),
    components,
  };
}

/** The commands of `plugins` by id; a later plugin never overrides an earlier id. */
export function pluginCommands(
  plugins: readonly EditorPlugin[],
): Map<string, EditorCommand> {
  const out = new Map<string, EditorCommand>();
  for (const plugin of sortPlugins(plugins)) {
    for (const [id, command] of Object.entries(plugin.commands ?? {})) {
      if (out.has(id)) continue;
      out.set(id, { id, ...command });
    }
  }
  return out;
}

/** Lower-cased, modifier-sorted combo, so `shift+Mod+Z` and `Mod+Shift+z` match. */
export function normalizeCombo(combo: string): string {
  const parts = combo.split('+').map((part) => part.trim().toLowerCase());
  const key = parts.pop() ?? '';
  const order = ['mod', 'ctrl', 'alt', 'shift'];
  const mods = parts
    .map((part) => (part === 'meta' || part === 'cmd' ? 'mod' : part))
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [...mods, key].join('+');
}

/**
 * Combo to command id: `base` with `plugins` on top (a plugin combo
 * replaces a default; an empty id unbinds it; earlier plugins win over
 * later ones). Reports each combo two plugins bind differently to
 * `onConflict`.
 */
export function pluginShortcuts(
  plugins: readonly EditorPlugin[],
  base: Readonly<Record<string, string>>,
  onConflict: (combo: string, kept: string, dropped: string) => void,
): Record<string, string> {
  const bound: Record<string, string> = {};
  for (const plugin of sortPlugins(plugins)) {
    for (const [combo, id] of Object.entries(plugin.shortcuts ?? {})) {
      const key = normalizeCombo(combo);
      const kept = bound[key];
      if (kept !== undefined) {
        if (kept !== id) onConflict(key, kept, id);
        continue;
      }
      bound[key] = id;
    }
  }
  const out: Record<string, string> = {};
  for (const [combo, id] of Object.entries(base)) {
    out[normalizeCombo(combo)] = id;
  }
  for (const [combo, id] of Object.entries(bound)) {
    if (id === '') delete out[combo];
    else out[combo] = id;
  }
  return out;
}

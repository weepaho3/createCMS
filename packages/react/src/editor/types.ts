import type { AnyEditorSchema } from './schema';
import type { EditorStore } from './store';

/**
 * What `Editor.Root` shares with every part below it. One context object for
 * the whole package: created once and shared by every entry.
 */
export type EditorContextValue = {
  readonly schema: AnyEditorSchema;
  readonly store: EditorStore;
  /** The user this editor edits as — the store's local user. */
  readonly userId: string;
};

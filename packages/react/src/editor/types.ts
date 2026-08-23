import type { FieldControls } from './field/types';
import type { AnyEditorSchema } from './schema';
import type { EditorScrollToOptions } from './scroll';
import type { EditorStore } from './store';

export type { EditorScrollToOptions } from './scroll';

/**
 * What `Editor.Root` shares with every part below it. One context object for
 * the whole package: created once and shared by every entry.
 */
export type EditorContextValue = {
  readonly schema: AnyEditorSchema;
  readonly store: EditorStore;
  /** The user this editor edits as: the store's local user. */
  readonly userId: string;
  /** Per-kind control components from `Editor.Root`'s `fields` prop (`{}` when none). */
  readonly fields: FieldControls;
  registerScrollTarget(blockId: string, el: HTMLElement): () => void;
  scrollTo(blockId: string, opts?: EditorScrollToOptions): boolean;
};

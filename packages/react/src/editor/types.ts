import type { Announcer } from './announcer';
import type { Messages, Platform } from './core/messages';
import type { AnyEditorSchema } from './core/schema';
import type { EditorStore } from './core/store';
import type { FieldControls } from './field/types';
import type { EditorScrollToOptions } from './scroll';

export type { EditorScrollToOptions } from './scroll';

/**
 * What `Editor.Root` shares with every part below it. One context object for
 * the whole package: created once and shared by every entry.
 */
export type EditorContextValue = {
  /** The store's schema (with plugin blocks and field kinds applied). */
  readonly schema: AnyEditorSchema;
  readonly store: EditorStore;
  /** The text catalog: English, then plugin entries, then `Editor.Root`'s `messages`. */
  readonly messages: Messages;
  /** Text direction of the editor UI. */
  readonly dir: 'ltr' | 'rtl';
  /** Keyboard label style (`apple` shows symbols). */
  readonly platform: Platform;
  /** The live region's message source (`Editor.LiveAnnouncer`, `useAnnounce`). */
  readonly announcer: Announcer;
  /** Per-kind control components from `Editor.Root`'s `fields` prop (`{}` when none). */
  readonly fields: FieldControls;
  registerScrollTarget(blockId: string, el: HTMLElement): () => void;
  scrollTo(blockId: string, opts?: EditorScrollToOptions): boolean;
};

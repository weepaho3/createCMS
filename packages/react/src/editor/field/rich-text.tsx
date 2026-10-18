import * as React from 'react';

import type {
  RichTextHandle,
  RichTextSuggestionItem,
  RichTextSuggestionState,
} from '../core/richtext/adapter';
import type { RichTextDoc, RichTextSchema } from '../core/richtext/types';

import { useEditorContext } from '../context';
import { EMPTY_RICH_TEXT, isRichTextDoc } from '../core/richtext/schema';
import { combosOf, handleEditorKey } from '../keyboard';

export type UseRichTextEditorOptions = {
  value: RichTextDoc | undefined;
  schema: RichTextSchema;
  onChange: (value: RichTextDoc) => void;
  /** Default `true`. */
  editable?: boolean;
  placeholder?: string;
  /** Attributes of the editable element (`id`, `aria-*`). */
  attributes?: Record<string, string>;
  /** Places the caret at this client point after mounting. */
  caretFrom?: { x: number; y: number };
  onFocus?: () => void;
  onBlur?: () => void;
  /** Completion after `char` (default `{{`), e.g. variables. */
  suggest?: {
    char?: string;
    items: (query: string) => readonly RichTextSuggestionItem[];
  };
};

export type UseRichTextEditorResult = {
  /** Attach to the element the editor mounts into. */
  ref: (el: HTMLElement | null) => void;
  /** The mounted editor; `null` before mounting or without an adapter. */
  handle: RichTextHandle | null;
  /** False without `Editor.Root richText`. */
  available: boolean;
  /** Changes with the selection and active formatting (re-read `isActive`). */
  selectionVersion: number;
  /** The open suggestion list, or `null`. */
  suggestion: RichTextSuggestionState | null;
};

/**
 * Mounts `Editor.Root`'s rich text adapter into an element and keeps it
 * in sync: edits go to `onChange`, and a value changed elsewhere (undo, a
 * remote edit) replaces the editor content.
 */
export function useRichTextEditor(
  options: UseRichTextEditorOptions,
): UseRichTextEditorResult {
  const { richText, store } = useEditorContext('useRichTextEditor');
  const [el, setEl] = React.useState<HTMLElement | null>(null);
  const [handle, setHandle] = React.useState<RichTextHandle | null>(null);
  const [selectionVersion, setSelectionVersion] = React.useState(0);
  const [suggestion, setSuggestion] =
    React.useState<RichTextSuggestionState | null>(null);
  const suggests = options.suggest !== undefined;
  const latest = React.useRef(options);
  const emitted = React.useRef<RichTextDoc | undefined>(options.value);
  React.useLayoutEffect(() => {
    latest.current = options;
  });

  React.useEffect(() => {
    if (!el || !richText) return;
    const current = latest.current;
    const mounted = richText.mount(el, {
      value: isRichTextDoc(current.value) ? current.value : EMPTY_RICH_TEXT,
      schema: current.schema,
      editable: current.editable ?? true,
      placeholder: current.placeholder,
      attributes: current.attributes,
      caretFrom: current.caretFrom,
      onChange: (value) => {
        emitted.current = value;
        latest.current.onChange(value);
      },
      onSelectionChange: () => setSelectionVersion((v) => v + 1),
      suggestion: suggests
        ? {
            char: current.suggest?.char,
            items: (query) => latest.current.suggest?.items(query) ?? [],
            onState: setSuggestion,
          }
        : undefined,
      onFocus: () => latest.current.onFocus?.(),
      onBlur: () => latest.current.onBlur?.(),
    });
    emitted.current = current.value;
    setHandle(mounted);
    return () => {
      mounted.destroy();
      setHandle(null);
    };
  }, [el, richText, suggests]);

  // The editor keeps no history: undo and redo inside it run the store's
  // commands even where no editor keyboard binding covers the page.
  React.useEffect(() => {
    if (!el) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const shortcuts = store.commands.shortcuts();
      const history = combosOf(event).some((combo) => {
        const id = shortcuts[combo];
        return id === 'history.undo' || id === 'history.redo';
      });
      if (history) handleEditorKey(store, event);
    };
    // Capture phase: the editor's own keymap must not see these keys first.
    el.addEventListener('keydown', onKeyDown, true);
    return () => el.removeEventListener('keydown', onKeyDown, true);
  }, [el, store]);

  const { value } = options;
  React.useEffect(() => {
    if (!handle || value === emitted.current) return;
    emitted.current = value;
    handle.setValue(isRichTextDoc(value) ? value : EMPTY_RICH_TEXT);
  }, [handle, value]);

  const editable = options.editable ?? true;
  React.useEffect(() => {
    handle?.setEditable(editable);
  }, [handle, editable]);

  return {
    ref: setEl,
    handle,
    available: richText !== null,
    selectionVersion,
    suggestion,
  };
}

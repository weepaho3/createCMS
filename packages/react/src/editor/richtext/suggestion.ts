import type { SuggestionProps } from '@tiptap/suggestion';

import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { Suggestion } from '@tiptap/suggestion';

import type {
  RichTextSuggestion,
  RichTextSuggestionItem,
  RichTextSuggestionState,
} from '../core/richtext/adapter';

const suggestionKey = new PluginKey('createcmsSuggestion');

/**
 * Completion after `suggestion.char` (default `{{`): reports the open list
 * through `onState` and handles its keys; Enter or Tab inserts the
 * highlighted item, Escape closes the list.
 */
export function suggestionExtension(suggestion: RichTextSuggestion) {
  return Extension.create({
    name: 'createcmsSuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion<RichTextSuggestionItem, RichTextSuggestionItem>({
          pluginKey: suggestionKey,
          editor: this.editor,
          char: suggestion.char ?? '{{',
          allowedPrefixes: null,
          items: ({ query }) => [...suggestion.items(query)],
          command: ({ editor, range, props }) => {
            editor
              .chain()
              .focus()
              .insertContentAt(range, props.insertText)
              .run();
          },
          render: () => {
            let index = 0;
            let current: SuggestionProps<
              RichTextSuggestionItem,
              RichTextSuggestionItem
            > | null = null;
            const report = () => {
              if (!current || current.items.length === 0) {
                suggestion.onState(null);
                return;
              }
              const props = current;
              const box = props.clientRect?.() ?? null;
              const state: RichTextSuggestionState = {
                query: props.query,
                items: props.items,
                index,
                rect: box
                  ? { x: box.x, y: box.y, width: box.width, height: box.height }
                  : null,
                select: (i) => {
                  const item = props.items[i];
                  if (item) props.command(item);
                },
              };
              suggestion.onState(state);
            };
            return {
              onStart: (props) => {
                current = props;
                index = 0;
                report();
              },
              onUpdate: (props) => {
                current = props;
                index = Math.min(index, Math.max(0, props.items.length - 1));
                report();
              },
              onExit: () => {
                current = null;
                suggestion.onState(null);
              },
              onKeyDown: ({ event }) => {
                const items = current?.items ?? [];
                if (items.length === 0) return false;
                if (event.key === 'ArrowDown') {
                  index = (index + 1) % items.length;
                  report();
                  return true;
                }
                if (event.key === 'ArrowUp') {
                  index = (index - 1 + items.length) % items.length;
                  report();
                  return true;
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  current?.command(items[index]!);
                  return true;
                }
                if (event.key === 'Escape') {
                  current = null;
                  suggestion.onState(null);
                  return true;
                }
                return false;
              },
            };
          },
        }),
      ];
    },
  });
}

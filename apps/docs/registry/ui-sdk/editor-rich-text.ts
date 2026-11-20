// @registry ui-sdk-editor@0.3.2
import {
  createChange,
  definePrimitive,
  dispatch,
  type ChangeDetails,
} from '@ui-sdk/core';

type ValueReason = 'input' | 'imperative';

export type EditorRichTextOptions = {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string, details: ChangeDetails<ValueReason>) => void;
  readOnly?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  highlighted?: number;
  onSuggestionSelect?: (
    index: number,
    details: ChangeDetails<'item-press'>,
  ) => void;
};

type RichTextState = {
  value: string;
  readOnly: boolean;
  disabled: boolean;
  invalid: boolean;
  highlighted: number;
};

export const editorRichText = definePrimitive({
  name: 'editor-rich-text',
  options: {
    value: 'string',
    defaultValue: 'string',
    onValueChange: 'callback',
    readOnly: 'boolean',
    disabled: 'boolean',
    invalid: 'boolean',
    highlighted: 'number',
    onSuggestionSelect: 'callback',
  },
  controlled: ['value'],
  state: (options: EditorRichTextOptions): RichTextState => ({
    value: options.value ?? options.defaultValue ?? '',
    readOnly: options.readOnly ?? false,
    disabled: options.disabled ?? false,
    invalid: options.invalid ?? false,
    highlighted: options.highlighted ?? -1,
  }),
  sync: (options) => {
    const next: Partial<RichTextState> = {
      readOnly: options.readOnly ?? false,
      disabled: options.disabled ?? false,
      invalid: options.invalid ?? false,
      highlighted: options.highlighted ?? -1,
    };
    if (options.value !== undefined) next.value = options.value;
    return next;
  },
  api: (context) => {
    const change = createChange(context);
    return {
      setValue(
        value: string,
        details: { reason: ValueReason; event?: Event } = {
          reason: 'imperative',
        },
      ) {
        const { readOnly, disabled } = context.store.get();
        if (readOnly || disabled) {
          throw new Error('This rich text field is read-only.');
        }
        if (typeof value !== 'string') throw new Error('The value is text.');
        return change('value', value, details);
      },
      choose(index: number, event?: MouseEvent) {
        dispatch(context, 'onSuggestionSelect', index, {
          reason: 'item-press',
          event,
        });
      },
    };
  },
  slots: (slot) => ({
    root: slot<{}, { readOnly: boolean; invalid: boolean }>({
      role: 'group',
      state: (state) => ({
        readOnly: state.readOnly || state.disabled,
        invalid: state.invalid,
      }),
      attrs: (state) => ({
        'data-readonly': state.readOnly || state.disabled ? '' : undefined,
        'data-disabled': state.disabled ? '' : undefined,
        'data-invalid': state.invalid ? '' : undefined,
      }),
    }),
    editable: slot({}),
    suggestions: slot({
      role: 'listbox',
      keys: {
        none: 'The editor keeps focus and moves through the list with the arrows.',
      },
      attrs: () => ({ 'aria-label': 'Suggestions' }),
    }),
    suggestion: slot<{ value: string; index: number }>({
      props: { value: 'string', index: 'number' },
      role: 'option',
      focus: { none: 'The editor keeps focus while the list is open.' },
      press: ({ api, props }, event) =>
        api.choose(props.index, event as MouseEvent),
      attrs: (state, part) => ({
        'aria-selected': String(state.highlighted === part.props.index),
        'data-highlighted':
          state.highlighted === part.props.index ? '' : undefined,
      }),
      on: { pointerdown: (event) => event.preventDefault() },
    }),
  }),
  agent: { actions: ['setValue'] },
});

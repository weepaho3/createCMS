import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type {
  RichTextHandle,
  RichTextSuggestionItem,
} from '../core/richtext/adapter';
import type { RichTextDoc, RichTextSchema } from '../core/richtext/types';
import type { RichTextField as RichTextFieldSpec } from '../core/schema';

import { composeRefs, useRender } from '../../use-render';
import { useEditorContext } from '../context';
import { richTextSchemaOf } from '../core/richtext/schema';
import { useMessages } from '../messages';
import { RichTextStatic } from '../render/rich-text';
import { useRovingFocus } from '../roving';
import { useFieldContext } from './context';
import { useRichTextEditor } from './rich-text';

/** What the toolbar parts read: the mounted editor and the field's schema. */
export type RichTextFieldContextValue = {
  handle: RichTextHandle | null;
  schema: RichTextSchema;
  selectionVersion: number;
  editable: boolean;
};

export const RichTextFieldContext =
  React.createContext<RichTextFieldContextValue | null>(null);

function useRichTextFieldContext(part: string): RichTextFieldContextValue {
  const value = React.useContext(RichTextFieldContext);
  if (!value) {
    throw new Error(`${part} must be used within an Editor.RichTextField.`);
  }
  return value;
}

/** Props of the shared view behind `Editor.RichTextField` and the default control. */
type RichTextViewProps = {
  spec: RichTextFieldSpec;
  value: RichTextDoc | undefined;
  onChange: (value: RichTextDoc) => void;
  id: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  readOnly: boolean;
  disabled: boolean;
  /** Rendered before the editable element (a toolbar). */
  toolbar?: React.ReactNode;
  suggest?: {
    char?: string;
    items: (query: string) => readonly RichTextSuggestionItem[];
  };
};

type RichTextFieldState = {
  editorRichtext: boolean;
  readonly: boolean;
  invalid: boolean;
};

function useRichTextView(props: RichTextViewProps) {
  const messages = useMessages();
  const schema = React.useMemo(
    () => richTextSchemaOf(props.spec),
    [props.spec],
  );
  const attributes: Record<string, string> = { id: props.id };
  if (props.describedBy) attributes['aria-describedby'] = props.describedBy;
  if (props.invalid) attributes['aria-invalid'] = 'true';
  if (props.required) attributes['aria-required'] = 'true';
  if (props.readOnly) attributes['aria-readonly'] = 'true';
  const editable = !props.readOnly && !props.disabled;
  const editor = useRichTextEditor({
    value: props.value,
    schema,
    onChange: props.onChange,
    editable,
    placeholder: props.spec.placeholder,
    attributes,
    suggest: props.suggest,
  });
  const context = React.useMemo<RichTextFieldContextValue>(
    () => ({
      handle: editor.handle,
      schema,
      selectionVersion: editor.selectionVersion,
      editable,
    }),
    [editor.handle, schema, editor.selectionVersion, editable],
  );
  const listId = `${props.id}-suggestions`;
  const suggestion = editor.suggestion;

  const children = editor.available ? (
    <RichTextFieldContext.Provider value={context}>
      {props.toolbar}
      <div data-editor-richtext-editable="" ref={editor.ref} />
      {suggestion ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={messages.parts.richTextSuggestions}
          data-editor-richtext-suggestions=""
          style={{
            position: 'fixed',
            left: suggestion.rect?.x ?? 0,
            top: (suggestion.rect?.y ?? 0) + (suggestion.rect?.height ?? 0),
          }}
        >
          {suggestion.items.map((item, i) => (
            <li
              key={item.insertText}
              role="option"
              aria-selected={i === suggestion.index}
              data-highlighted={i === suggestion.index ? '' : undefined}
              onMouseDown={(event) => {
                event.preventDefault();
                suggestion.select(i);
              }}
            >
              <span>{item.label}</span>
              {item.description ? <span>{item.description}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </RichTextFieldContext.Provider>
  ) : (
    <>
      <div
        id={props.id}
        role="textbox"
        aria-multiline={!schema.inline || undefined}
        tabIndex={0}
        aria-describedby={props.describedBy}
        aria-invalid={props.invalid || undefined}
        aria-required={props.required || undefined}
        aria-readonly="true"
      >
        <RichTextStatic value={props.value} />
      </div>
      <p data-editor-richtext-hint="">{messages.parts.richTextReadOnly}</p>
    </>
  );
  const state: RichTextFieldState = {
    editorRichtext: true,
    readonly: !editor.available || !editable,
    invalid: props.invalid,
  };
  return { children, state };
}

/**
 * The default `richText` control: a toolbar for the formatting the field
 * allows and the `Editor.Root richText` editor; without one, the formatted
 * text read-only with a hint.
 */
export function RichTextControlView(props: RichTextViewProps) {
  const { children, state } = useRichTextView({
    ...props,
    toolbar: props.toolbar ?? <DefaultRichTextToolbar />,
  });
  return (
    <div
      data-editor-richtext=""
      data-readonly={state.readonly ? '' : undefined}
      data-invalid={state.invalid ? '' : undefined}
    >
      {children}
    </div>
  );
}

export type EditorRichTextFieldProps = UseRenderComponentProps<
  'div',
  RichTextFieldState
> & {
  /** Completion after `char` (default `{{`), e.g. `useVariableSuggest`. */
  suggest?: RichTextViewProps['suggest'];
};

/**
 * The rich text editor of the enclosing `Editor.Field`: children (an
 * `Editor.RichTextToolbar`) render before the editable element, and an
 * open suggestion list renders as a `listbox` after it. Without
 * `Editor.Root richText` it shows the formatted text read-only.
 */
export function EditorRichTextField({
  suggest,
  render,
  children: toolbar,
  ...rest
}: EditorRichTextFieldProps) {
  const field = useFieldContext('Editor.RichTextField');
  const spec = field.spec;
  if (spec.type !== 'richText') {
    throw new Error('Editor.RichTextField needs a richText field.');
  }
  const { children, state } = useRichTextView({
    spec,
    value: field.value as RichTextDoc | undefined,
    onChange: field.setValue,
    id: field.id,
    describedBy: field.describedBy,
    invalid: field.invalid,
    required: field.required,
    readOnly: field.readOnly,
    disabled: field.disabled,
    toolbar,
    suggest,
  });
  return useRender<'div', RichTextFieldState>({
    defaultTagName: 'div',
    render,
    props: { ...rest, children },
    state,
  });
}

type ToolbarState = { disabled: boolean };

export type EditorRichTextToolbarProps = UseRenderComponentProps<
  'div',
  ToolbarState
>;

/**
 * `role="toolbar"` for an `Editor.RichTextField`: one tab stop, arrows move
 * between its buttons (APG toolbar).
 */
export function EditorRichTextToolbar({
  render,
  onKeyDown,
  onFocus,
  ref,
  ...rest
}: EditorRichTextToolbarProps) {
  const field = useRichTextFieldContext('Editor.RichTextToolbar');
  const messages = useMessages();
  const { dir } = useEditorContext('Editor.RichTextToolbar');
  const roving = useRovingFocus<HTMLDivElement>({ dir });
  return useRender<'div', ToolbarState>({
    defaultTagName: 'div',
    render,
    props: {
      role: 'toolbar',
      'aria-label': messages.parts.richTextToolbar,
      ...rest,
      ref: composeRefs(roving.ref, ref),
      onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented) roving.onKeyDown(event);
      },
      onFocus: (event: React.FocusEvent<HTMLDivElement>) => {
        onFocus?.(event);
        roving.onFocus(event);
      },
    },
    state: { disabled: !field.editable },
  });
}

type ButtonState = { active: boolean; disabled: boolean };

export type EditorRichTextToolbarButtonProps = UseRenderComponentProps<
  'button',
  ButtonState
> & {
  /** Toggles this mark (`bold`, `italic`, ...). */
  mark?: string;
  /** Or turns the selection into this node (`heading`, `bulletList`, ...). */
  node?: string;
  /** Node attributes (`{ level: 2 }` for a heading). */
  attrs?: Record<string, string | number | boolean | null>;
};

/**
 * A formatting button: `aria-pressed` while active, keeps the editor's
 * focus and selection (no focus on press), disabled for formatting the
 * field does not allow.
 */
export function EditorRichTextToolbarButton({
  mark,
  node,
  attrs,
  render,
  onClick,
  onMouseDown,
  ...rest
}: EditorRichTextToolbarButtonProps) {
  const field = useRichTextFieldContext('Editor.RichTextToolbarButton');
  const name = mark ?? node ?? '';
  const allowed = mark
    ? field.schema.marks.includes(mark)
    : node === 'paragraph' ||
      (!field.schema.inline && field.schema.nodes.includes(name));
  const disabled = !field.editable || !field.handle || !allowed;
  // Re-read on every selection change.
  void field.selectionVersion;
  const active =
    field.handle !== null && name !== ''
      ? field.handle.commands.isActive(name, attrs ?? undefined)
      : false;
  return useRender<'button', ButtonState>({
    defaultTagName: 'button',
    render,
    props: {
      type: 'button',
      'aria-pressed': active,
      disabled,
      ...rest,
      onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => {
        onMouseDown?.(event);
        // The editor keeps its focus and selection.
        event.preventDefault();
      },
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || !field.handle) return;
        if (mark) field.handle.commands.toggleMark(mark);
        else if (node === 'heading' && active) {
          // Pressing an active heading level turns it back into text.
          field.handle.commands.setNode('paragraph');
        } else if (node)
          field.handle.commands.setNode(node, attrs ?? undefined);
      },
    },
    state: { active, disabled },
  });
}

const DEFAULT_MARKS = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
] as const;
const DEFAULT_NODES = [
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
] as const;

/** The default control's toolbar: every mark and node the field allows. */
export function DefaultRichTextToolbar() {
  const field = useRichTextFieldContext('Editor.RichTextToolbar');
  const format = useMessages().parts.richTextFormat;
  const marks = DEFAULT_MARKS.filter((m) => field.schema.marks.includes(m));
  const headings =
    !field.schema.inline && field.schema.nodes.includes('heading')
      ? [2, 3]
      : [];
  const nodes = field.schema.inline
    ? []
    : DEFAULT_NODES.filter((n) => field.schema.nodes.includes(n));
  if (marks.length + headings.length + nodes.length === 0) return null;
  return (
    <EditorRichTextToolbar>
      {marks.map((m) => (
        <EditorRichTextToolbarButton key={m} mark={m}>
          {format[m]}
        </EditorRichTextToolbarButton>
      ))}
      {headings.map((level) => (
        <EditorRichTextToolbarButton
          key={`h${level}`}
          node="heading"
          attrs={{ level }}
        >
          {format.heading({ level })}
        </EditorRichTextToolbarButton>
      ))}
      {nodes.map((n) => (
        <EditorRichTextToolbarButton key={n} node={n}>
          {format[n]}
        </EditorRichTextToolbarButton>
      ))}
    </EditorRichTextToolbar>
  );
}

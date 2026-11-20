// @registry ui-sdk-editor@0.3.2
'use client';

import type {
  FieldControlProps,
  RichTextToolbarState,
  UseRichTextEditorOptions,
} from '@createcms/react/editor';
import type { RichTextDoc } from '@createcms/react/editor/core';

import {
  RichTextStatic,
  useFieldContext,
  useRichTextEditor,
  useRichTextToolbarState,
  useTextBinding,
} from '@createcms/react/editor';
import {
  plainTextToRichText,
  richTextSchemaOf,
  richTextToPlainText,
} from '@createcms/react/editor/core';
import { useFieldControl } from '@ui-sdk/react/field';
import { createParts } from '@ui-sdk/react/primitive';
import { Toggle } from '@ui-sdk/react/toggle';
import { Toolbar } from '@ui-sdk/react/toolbar';
import * as React from 'react';

import { editorRichText } from './editor-rich-text';

const Parts = createParts(editorRichText, {
  root: 'div',
  editable: 'div',
  suggestions: 'ul',
  suggestion: 'li',
});

type Format = {
  name: string;
  label: string;
  text: string;
  kind: 'mark' | 'node';
  attrs?: Record<string, number>;
};

const MARKS: readonly Format[] = [
  { name: 'bold', label: 'Bold', text: 'B', kind: 'mark' },
  { name: 'italic', label: 'Italic', text: 'I', kind: 'mark' },
  { name: 'underline', label: 'Underline', text: 'U', kind: 'mark' },
  { name: 'strike', label: 'Strikethrough', text: 'S', kind: 'mark' },
];

const BLOCKS: readonly Format[] = [
  {
    name: 'heading',
    label: 'Heading',
    text: 'H2',
    kind: 'node',
    attrs: { level: 2 },
  },
  { name: 'bulletList', label: 'Bulleted list', text: '•', kind: 'node' },
  { name: 'orderedList', label: 'Numbered list', text: '1.', kind: 'node' },
];

function FormatToggle({
  format,
  state,
  name,
}: {
  format: Format;
  state: RichTextToolbarState;
  name: string;
}) {
  const { handle, schema, editable } = state;
  const allowed =
    format.kind === 'mark'
      ? schema.marks.includes(format.name)
      : !schema.inline && schema.nodes.includes(format.name);
  if (!allowed) return null;
  void state.selectionVersion;
  const active = handle?.commands.isActive(format.name, format.attrs) ?? false;
  return (
    <Toggle
      pressed={active}
      disabled={!editable || !handle}
      aria-label={`${format.label} ${name}`.trim()}
      title={format.label}
      className="ed-format"
      data-mark={format.kind === 'mark' ? format.name : undefined}
      onPointerDown={(event) => event.preventDefault()}
      onPressedChange={() => {
        if (!handle) return;
        if (format.kind === 'mark') handle.commands.toggleMark(format.name);
        else if (format.name === 'heading' && active)
          handle.commands.setNode('paragraph');
        else handle.commands.setNode(format.name, format.attrs);
      }}
    >
      {format.text}
    </Toggle>
  );
}

function Formats({
  state,
  blocks,
  name = '',
}: {
  state: RichTextToolbarState;
  blocks: boolean;
  name?: string;
}) {
  return (
    <>
      {MARKS.map((format) => (
        <FormatToggle
          key={format.name}
          format={format}
          state={state}
          name={name}
        />
      ))}
      {blocks
        ? BLOCKS.map((format) => (
            <FormatToggle
              key={format.name}
              format={format}
              state={state}
              name={name}
            />
          ))
        : null}
    </>
  );
}

export function InlineFormats() {
  const state = useRichTextToolbarState();
  if (!state) return null;
  return <Formats state={state} blocks={false} />;
}

const stringAttributes = (props: Record<string, unknown>) => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === 'id' || key.startsWith('aria-')) {
      if (typeof value === 'string') out[key] = value;
      else if (value === true) out[key] = 'true';
    }
  }
  return out;
};

export function RichTextField({
  suggest,
  ...props
}: FieldControlProps<'richText'> & {
  suggest?: UseRichTextEditorOptions['suggest'];
}) {
  const field = useFieldContext('RichTextField');
  const top = field.id === props.id;
  const binding = useTextBinding(
    top ? field.blockId : undefined,
    top ? field.name : undefined,
  );
  const schema = React.useMemo(
    () => richTextSchemaOf(props.spec),
    [props.spec],
  );
  const control = useFieldControl();
  const own = { id: props.id };
  const attributes = stringAttributes(control ? control.props(own) : own);
  const editable = !props.readOnly && !props.disabled;
  const editor = useRichTextEditor({
    value: props.value,
    schema,
    onChange: props.onChange,
    editable,
    placeholder: props.spec.placeholder,
    attributes,
    suggest,
    binding,
  });
  const text = React.useMemo(
    () => (props.value ? richTextToPlainText(props.value as RichTextDoc) : ''),
    [props.value],
  );
  const state = React.useMemo<RichTextToolbarState>(
    () => ({
      handle: editor.handle,
      schema,
      selectionVersion: editor.selectionVersion,
      editable,
    }),
    [editor.handle, schema, editor.selectionVersion, editable],
  );
  const name = props.spec.label ?? props.name;
  const suggestion = editor.suggestion;

  return (
    <Parts.Root
      aria-labelledby={attributes['aria-labelledby']}
      className="ed-input ed-richtext"
      value={text}
      onValueChange={(next) =>
        props.onChange(plainTextToRichText(next, { inline: schema.inline }))
      }
      readOnly={props.readOnly}
      disabled={props.disabled}
      invalid={props.invalid}
      highlighted={suggestion?.index ?? -1}
      onSuggestionSelect={(index) => suggestion?.select(index)}
    >
      {editor.available ? (
        <>
          <Toolbar
            aria-label={`${name} formatting`}
            className="ed-richtext-toolbar"
          >
            <Formats state={state} blocks={!schema.inline} name={name} />
          </Toolbar>
          <Parts.Editable ref={editor.ref} className="ed-richtext-editable" />
          {suggestion ? (
            <Parts.Suggestions
              className="ed-popup ed-list ed-suggestions"
              style={{
                left: suggestion.rect?.x ?? 0,
                top: (suggestion.rect?.y ?? 0) + (suggestion.rect?.height ?? 0),
              }}
            >
              {suggestion.items.map((item, index) => (
                <Parts.Suggestion
                  key={item.insertText}
                  value={item.insertText}
                  index={index}
                  className="ed-item"
                >
                  <span>{item.label}</span>
                  {item.description ? (
                    <span className="ed-muted">{item.description}</span>
                  ) : null}
                </Parts.Suggestion>
              ))}
            </Parts.Suggestions>
          ) : null}
        </>
      ) : (
        <Parts.Editable className="ed-richtext-editable" data-static="">
          <RichTextStatic value={props.value} />
        </Parts.Editable>
      )}
    </Parts.Root>
  );
}

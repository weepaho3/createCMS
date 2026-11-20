// @registry ui-sdk-editor@0.3.2
'use client';

import type { FieldControlProps, FieldControls } from '@createcms/react/editor';

import {
  Editor,
  emptyListElement,
  fromDatetimeLocal,
  toDatetimeLocal,
} from '@createcms/react/editor';
import { Button } from '@ui-sdk/react/button';
import {
  Checkbox,
  CheckboxGroup,
  CheckboxIndicator,
} from '@ui-sdk/react/checkbox';
import {
  ColorPicker,
  ColorPickerArea,
  ColorPickerAreaThumb,
  ColorPickerInput,
  ColorPickerSlider,
  ColorPickerSliderThumb,
} from '@ui-sdk/react/color-picker';
import { Field, FieldLabel, useFieldControl } from '@ui-sdk/react/field';
import { Input } from '@ui-sdk/react/input';
import {
  NumberInput,
  NumberInputControl,
  NumberInputDecrement,
  NumberInputGroup,
  NumberInputIncrement,
} from '@ui-sdk/react/number-input';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@ui-sdk/react/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectTrigger,
  SelectValue,
} from '@ui-sdk/react/select';
import { Textarea } from '@ui-sdk/react/textarea';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  MinusIcon,
  PlusIcon,
  XIcon,
} from 'lucide-react';
import * as React from 'react';

const nameOf = (props: { spec: { label?: string }; name: string }) =>
  props.spec.label ?? props.name;

function TextField(props: FieldControlProps<'text'>) {
  return (
    <Input
      id={props.id}
      name={props.name}
      className="ed-input"
      value={props.value ?? ''}
      placeholder={props.spec.placeholder}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      minLength={props.spec.minLength}
      maxLength={props.spec.maxLength}
      onValueChange={(value) => props.onChange(value)}
    />
  );
}

function TextareaField(props: FieldControlProps<'textarea'>) {
  return (
    <Textarea
      id={props.id}
      name={props.name}
      className="ed-input"
      data-multiline=""
      rows={3}
      value={props.value ?? ''}
      placeholder={props.spec.placeholder}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      minLength={props.spec.minLength}
      maxLength={props.spec.maxLength}
      onValueChange={(value) => props.onChange(value)}
    />
  );
}

function NumberField(props: FieldControlProps<'number'>) {
  const name = nameOf(props);
  return (
    <NumberInput
      name={props.name}
      value={props.value ?? null}
      min={props.spec.min}
      max={props.spec.max}
      step={props.spec.step}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      onValueChange={(value) => props.onChange(value ?? undefined)}
    >
      <NumberInputGroup className="ed-input ed-number">
        <NumberInputDecrement aria-label={`Decrease ${name}`}>
          <MinusIcon />
        </NumberInputDecrement>
        <NumberInputControl
          id={props.id}
          placeholder={props.spec.placeholder}
        />
        <NumberInputIncrement aria-label={`Increase ${name}`}>
          <PlusIcon />
        </NumberInputIncrement>
      </NumberInputGroup>
    </NumberInput>
  );
}

function Check(props: React.ComponentProps<typeof Checkbox>) {
  return (
    <Checkbox className="ed-check" {...props}>
      <CheckboxIndicator>
        <CheckIcon />
      </CheckboxIndicator>
    </Checkbox>
  );
}

function BooleanField(props: FieldControlProps<'boolean'>) {
  return (
    <Check
      id={props.id}
      name={props.name}
      checked={props.value ?? false}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      onCheckedChange={(checked) => props.onChange(checked === true)}
    />
  );
}

function DateField(props: FieldControlProps<'date'>) {
  return (
    <Input
      type="datetime-local"
      id={props.id}
      name={props.name}
      className="ed-input"
      value={toDatetimeLocal(props.value)}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      onValueChange={(value) => props.onChange(fromDatetimeLocal(value))}
    />
  );
}

function ColorField(props: FieldControlProps<'color'>) {
  const value = props.value ?? '#000000';
  const control = useFieldControl();
  const own = {
    id: props.id,
    disabled: props.disabled || props.readOnly,
    className: 'ed-input ed-color-trigger',
  };
  return (
    <Popover>
      <PopoverTrigger {...(control ? control.props(own) : own)}>
        <span
          aria-hidden
          className="ed-color-swatch"
          style={{ background: value }}
        />
        <span>{value}</span>
      </PopoverTrigger>
      <PopoverContent sideOffset={6} className="ed-popup ed-color-popup">
        <PopoverTitle className="ed-sr">{nameOf(props)}</PopoverTitle>
        <ColorPicker
          aria-label={nameOf(props)}
          format="hex"
          value={value}
          onValueCommit={(next) => props.onChange(next)}
          className="ed-color"
        >
          <ColorPickerArea className="ed-color-area">
            <ColorPickerAreaThumb className="ed-color-thumb" />
          </ColorPickerArea>
          <ColorPickerSlider channel="hue" className="ed-color-slider">
            <ColorPickerSliderThumb className="ed-color-thumb" />
          </ColorPickerSlider>
          <ColorPickerInput aria-label="Hex" className="ed-input" />
        </ColorPicker>
      </PopoverContent>
    </Popover>
  );
}

function SelectField(props: FieldControlProps<'select'>) {
  const options = props.spec.options;
  if (props.spec.multiple) {
    const selected = Array.isArray(props.value) ? props.value : [];
    return (
      <CheckboxGroup
        id={props.id}
        className="ed-choices"
        value={selected}
        disabled={props.disabled}
        readOnly={props.readOnly}
        onValueChange={(next) =>
          props.onChange(
            options.map((o) => o.value).filter((v) => next.includes(v)),
          )
        }
      >
        {options.map((option) => (
          <label key={option.value} className="ed-choice">
            <Check value={option.value} />
            {option.label}
          </label>
        ))}
      </CheckboxGroup>
    );
  }
  return (
    <Choice
      id={props.id}
      name={props.name}
      value={typeof props.value === 'string' ? props.value : null}
      options={options}
      placeholder={props.spec.placeholder}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      onValueChange={(value) => props.onChange(value || undefined)}
    />
  );
}

export function Choice({
  value,
  options,
  onValueChange,
  placeholder,
  name,
  required,
  disabled,
  readOnly,
  ...trigger
}: {
  value: string | null;
  options: readonly { value: string; label: string }[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  'aria-required'?: true;
}) {
  return (
    <Select
      name={name}
      value={value}
      items={options.map((option) => ({ ...option }))}
      placeholder={placeholder ?? ''}
      required={required}
      disabled={disabled}
      readOnly={readOnly}
      onValueChange={(next) => {
        if (typeof next === 'string') onValueChange(next);
      }}
    >
      <SelectTrigger className="ed-input ed-select" {...trigger}>
        <SelectValue />
        <ChevronsUpDownIcon aria-hidden />
      </SelectTrigger>
      <SelectContent sideOffset={4} className="ed-popup ed-list">
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className="ed-item"
          >
            {option.label}
            <SelectItemIndicator className="ed-item-end">
              <CheckIcon />
            </SelectItemIndicator>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const MARKS = [
  { mark: 'bold', label: 'Bold', text: 'B' },
  { mark: 'italic', label: 'Italic', text: 'I' },
  { mark: 'underline', label: 'Underline', text: 'U' },
  { mark: 'strike', label: 'Strikethrough', text: 'S' },
] as const;

const BLOCKS = [
  { node: 'heading', attrs: { level: 2 }, label: 'Heading', text: 'H2' },
  { node: 'bulletList', label: 'Bulleted list', text: '•' },
  { node: 'orderedList', label: 'Numbered list', text: '1.' },
] as const;

export function RichTextFormats({
  marks,
  blocks = true,
}: {
  marks?: readonly string[];
  blocks?: boolean;
}) {
  return (
    <>
      {MARKS.filter((m) => marks === undefined || marks.includes(m.mark)).map(
        (m) => (
          <Editor.RichTextToolbarButton
            key={m.mark}
            mark={m.mark}
            aria-label={m.label}
            title={m.label}
            className="ed-format"
            data-mark={m.mark}
          >
            {m.text}
          </Editor.RichTextToolbarButton>
        ),
      )}
      {blocks
        ? BLOCKS.map((b) => (
            <Editor.RichTextToolbarButton
              key={b.node}
              node={b.node}
              attrs={'attrs' in b ? b.attrs : undefined}
              aria-label={b.label}
              title={b.label}
              className="ed-format"
            >
              {b.text}
            </Editor.RichTextToolbarButton>
          ))
        : null}
    </>
  );
}

export function RichTextField({
  suggest,
  ...props
}: FieldControlProps<'richText'> & {
  suggest?: React.ComponentProps<typeof Editor.RichTextField>['suggest'];
}) {
  return (
    <Editor.RichTextField suggest={suggest} className="ed-input ed-richtext">
      <Editor.RichTextToolbar className="ed-richtext-toolbar">
        <RichTextFormats marks={props.spec.marks} blocks={!props.spec.inline} />
      </Editor.RichTextToolbar>
    </Editor.RichTextField>
  );
}

function useStableKeys(length: number) {
  const next = React.useRef(0);
  const keys = React.useRef<number[]>([]);
  while (keys.current.length < length) keys.current.push(next.current++);
  if (keys.current.length > length) keys.current.length = length;
  return {
    keys: keys.current,
    move(from: number, to: number) {
      const [key] = keys.current.splice(from, 1);
      keys.current.splice(to, 0, key!);
    },
    remove(index: number) {
      keys.current.splice(index, 1);
    },
  };
}

function ListField(props: FieldControlProps<'list'>) {
  const items = props.value ?? [];
  const { min = 0, max = Number.POSITIVE_INFINITY } = props.spec;
  const label = nameOf(props);
  const locked = props.disabled || props.readOnly;
  const stable = useStableKeys(items.length);
  const set = (next: unknown[]) => props.onChange(next);
  const move = (from: number, to: number) => {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    stable.move(from, to);
    set(next);
  };
  return (
    <div id={props.id} className="ed-list-field">
      <ol>
        {items.map((item, index) => {
          const name = `${label} ${index + 1}`;
          return (
            <li key={stable.keys[index]} className="ed-card">
              <Field className="ed-field">
                <FieldLabel className="ed-sr">{name}</FieldLabel>
                {props.renderElement?.({
                  spec: { ...props.spec.of, label: name },
                  value: item,
                  onChange: (next) => {
                    const copy = [...items];
                    copy[index] = next;
                    set(copy);
                  },
                  id: `${props.id}-${stable.keys[index]}`,
                  name: `${props.name}[${index}]`,
                  index,
                  disabled: props.disabled,
                  readOnly: props.readOnly,
                  invalid: false,
                  describedBy: undefined,
                })}
              </Field>
              <div className="ed-row">
                <Button
                  className="ed-button"
                  data-variant="ghost"
                  data-size="icon-xs"
                  aria-label={`Move ${name} up`}
                  disabled={locked || index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  className="ed-button"
                  data-variant="ghost"
                  data-size="icon-xs"
                  aria-label={`Move ${name} down`}
                  disabled={locked || index === items.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  className="ed-button"
                  data-variant="ghost"
                  data-size="icon-xs"
                  aria-label={`Remove ${name}`}
                  disabled={locked || items.length <= min}
                  onClick={() => {
                    stable.remove(index);
                    set(items.filter((_, i) => i !== index));
                  }}
                >
                  <XIcon />
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
      <Button
        className="ed-button"
        data-variant="outline"
        disabled={locked || items.length >= max}
        onClick={() => set([...items, emptyListElement(props.spec.of)])}
      >
        <PlusIcon />
        Add {label}
      </Button>
    </div>
  );
}

function ObjectField(props: FieldControlProps<'object'>) {
  const value = props.value ?? {};
  return (
    <div id={props.id} className="ed-card">
      {Object.entries(props.spec.fields).map(([key, spec]) => (
        <Field key={key} className="ed-field">
          <FieldLabel className="ed-label">{spec.label ?? key}</FieldLabel>
          {props.renderNested?.({
            spec: { ...spec, label: spec.label ?? key },
            fieldKey: key,
            value: value[key],
            onChange: (next) => {
              const copy: Record<string, unknown> = { ...value };
              if (next === undefined) delete copy[key];
              else copy[key] = next;
              props.onChange(copy);
            },
            id: `${props.id}-${key}`,
            name: `${props.name}.${key}`,
            disabled: props.disabled,
            readOnly: props.readOnly,
            invalid: false,
            describedBy: undefined,
          })}
        </Field>
      ))}
    </div>
  );
}

export const fields = {
  text: TextField,
  textarea: TextareaField,
  number: NumberField,
  boolean: BooleanField,
  date: DateField,
  color: ColorField,
  select: SelectField,
  richText: RichTextField,
  list: ListField,
  object: ObjectField,
} satisfies FieldControls;

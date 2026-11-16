// @registry ui-sdk-editor-field@0.3.2
'use client';

// Styled wrappers for the Editor.Field parts (label, control, description,
// error) and UI SDK controls for the built-in field kinds: pass
// `fields={fieldControls}` to Editor.Root. Use inside Editor.Root.

import type { FieldControlProps, FieldControls } from '@createcms/react/editor';

import {
  Editor,
  emptyListElement,
  fromDatetimeLocal,
  toDatetimeLocal,
} from '@createcms/react/editor';
import { Checkbox, CheckboxIndicator } from '@ui-sdk/react/checkbox';
import {
  NumberInput,
  NumberInputControl,
  NumberInputDecrement,
  NumberInputGroup,
  NumberInputIncrement,
} from '@ui-sdk/react/number-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectTrigger,
  SelectValue,
} from '@ui-sdk/react/select';
import { CheckIcon, ChevronDownIcon, MinusIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

import {
  Button,
  Input,
  Textarea,
  fieldClass,
  itemClass,
  popupClass,
} from './ui';

function Field({
  className,
  ...props
}: React.ComponentProps<typeof Editor.Field>) {
  return (
    <Editor.Field
      data-slot="editor-field"
      className={cn(
        'flex flex-col gap-1.5',
        'data-[kind=boolean]:grid data-[kind=boolean]:grid-cols-[auto_1fr] data-[kind=boolean]:items-center data-[kind=boolean]:gap-x-2 data-[kind=boolean]:gap-y-1',
        'data-[kind=boolean]:[&>[data-slot=editor-field-control]]:col-start-1 data-[kind=boolean]:[&>[data-slot=editor-field-control]]:row-start-1 data-[kind=boolean]:[&>[data-slot=editor-field-control]]:w-fit',
        'data-[kind=boolean]:[&>[data-slot=editor-field-label]]:col-start-2 data-[kind=boolean]:[&>[data-slot=editor-field-label]]:row-start-1',
        'data-[kind=boolean]:[&>[data-slot=editor-field-description]]:col-start-2',
        'data-[kind=boolean]:[&>[data-slot=editor-field-error]]:col-start-2',
        className,
      )}
      {...props}
    />
  );
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Editor.FieldLabel>) {
  return (
    <Editor.FieldLabel
      data-slot="editor-field-label"
      className={cn(
        'text-sm leading-none font-medium data-required:after:ml-0.5 data-required:after:content-["*"]',
        className,
      )}
      {...props}
    />
  );
}

function FieldControl(props: React.ComponentProps<typeof Editor.FieldControl>) {
  return (
    <div data-slot="editor-field-control" className="w-full">
      <Editor.FieldControl {...props} />
    </div>
  );
}

function FieldDescription({
  className,
  ...props
}: React.ComponentProps<typeof Editor.FieldDescription>) {
  return (
    <Editor.FieldDescription
      data-slot="editor-field-description"
      className={cn('text-sm text-editor-muted', className)}
      {...props}
    />
  );
}

function FieldError({
  className,
  ...props
}: React.ComponentProps<typeof Editor.FieldError>) {
  return (
    <Editor.FieldError
      data-slot="editor-field-error"
      className={cn('text-sm text-editor-invalid', className)}
      {...props}
    />
  );
}

function fieldAria(props: {
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  readOnly?: boolean;
}) {
  return {
    'aria-describedby': props.describedBy,
    'aria-invalid': props.invalid || undefined,
    'aria-required': props.required || undefined,
    'aria-readonly': props.readOnly || undefined,
  } as const;
}

function TextField(props: FieldControlProps<'text'>) {
  return (
    <Input
      type="text"
      id={props.id}
      name={props.name}
      value={props.value ?? ''}
      placeholder={props.spec.placeholder}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      minLength={props.spec.minLength}
      maxLength={props.spec.maxLength}
      {...fieldAria(props)}
      onValueChange={(value) => props.onChange(value)}
    />
  );
}

function TextareaField(props: FieldControlProps<'textarea'>) {
  return (
    <Textarea
      id={props.id}
      name={props.name}
      value={props.value ?? ''}
      placeholder={props.spec.placeholder}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      minLength={props.spec.minLength}
      maxLength={props.spec.maxLength}
      rows={3}
      {...fieldAria(props)}
      onValueChange={(value) => props.onChange(value)}
    />
  );
}

function ColorField(props: FieldControlProps<'color'>) {
  return (
    <Input
      type="color"
      id={props.id}
      name={props.name}
      value={props.value ?? '#000000'}
      required={props.required}
      disabled={props.disabled || props.readOnly}
      className="h-9 w-16 p-1"
      {...fieldAria(props)}
      onValueChange={(value) => props.onChange(value)}
    />
  );
}

const STEP_BUTTON =
  'text-muted-foreground hover:bg-muted flex w-8 shrink-0 items-center justify-center data-disabled:opacity-50 [&_svg]:size-3.5';

function NumberField(props: FieldControlProps<'number'>) {
  return (
    <NumberInput
      name={props.name}
      value={props.value ?? null}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      min={props.spec.min}
      max={props.spec.max}
      step={props.spec.step}
      onValueChange={(value) => props.onChange(value ?? undefined)}
    >
      <NumberInputGroup
        className={cn(
          fieldClass,
          'flex h-8 items-stretch overflow-hidden px-0 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
        )}
      >
        <NumberInputDecrement
          aria-label={`Decrease ${props.spec.label ?? props.name}`}
          className={cn(STEP_BUTTON, 'border-input border-e')}
        >
          <MinusIcon />
        </NumberInputDecrement>
        <NumberInputControl
          id={props.id}
          placeholder={props.spec.placeholder}
          className="min-w-0 flex-1 bg-transparent px-2.5 text-sm tabular-nums outline-none"
          {...fieldAria(props)}
        />
        <NumberInputIncrement
          aria-label={`Increase ${props.spec.label ?? props.name}`}
          className={cn(STEP_BUTTON, 'border-input border-s')}
        >
          <PlusIcon />
        </NumberInputIncrement>
      </NumberInputGroup>
    </NumberInput>
  );
}

const CHECKBOX =
  'border-input data-checked:bg-primary data-checked:border-primary data-checked:text-primary-foreground focus-visible:ring-ring/50 flex size-4 shrink-0 items-center justify-center rounded-[4px] border outline-none focus-visible:ring-[3px] data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-invalid:border-destructive';

function CheckboxBox({
  className,
  ...props
}: Omit<React.ComponentProps<typeof Checkbox>, 'className' | 'children'> & {
  className?: string;
}) {
  return (
    <Checkbox className={cn(CHECKBOX, className)} {...props}>
      <CheckboxIndicator className="flex items-center justify-center">
        <CheckIcon className="size-3.5" />
      </CheckboxIndicator>
    </Checkbox>
  );
}

function BooleanField(props: FieldControlProps<'boolean'>) {
  return (
    <CheckboxBox
      id={props.id}
      name={props.name}
      checked={props.value ?? false}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      {...fieldAria(props)}
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
      value={toDatetimeLocal(props.value)}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      {...fieldAria(props)}
      onValueChange={(value) => props.onChange(fromDatetimeLocal(value))}
    />
  );
}

function SelectField(props: FieldControlProps<'select'>) {
  if (props.spec.multiple) {
    const selected = Array.isArray(props.value) ? props.value : [];
    return (
      <div
        id={props.id}
        role="group"
        className="flex flex-col gap-2"
        {...fieldAria(props)}
      >
        {props.spec.options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm">
            <CheckboxBox
              checked={selected.includes(option.value)}
              disabled={props.disabled}
              readOnly={props.readOnly}
              onCheckedChange={(checked) =>
                props.onChange(
                  checked === true
                    ? [...selected, option.value]
                    : selected.filter((value) => value !== option.value),
                )
              }
            />
            {option.label}
          </label>
        ))}
      </div>
    );
  }
  return (
    <Select
      name={props.name}
      value={typeof props.value === 'string' ? props.value : null}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      placeholder={props.spec.placeholder ?? ''}
      items={props.spec.options.map((option) => ({
        value: option.value,
        label: option.label,
      }))}
      onValueChange={(value) =>
        props.onChange(
          typeof value !== 'string' || value === '' ? undefined : value,
        )
      }
    >
      <SelectTrigger
        id={props.id}
        className={cn(
          fieldClass,
          'flex h-8 items-center justify-between gap-2 text-start data-placeholder:text-muted-foreground',
        )}
        {...fieldAria(props)}
      >
        <SelectValue className="truncate" />
        <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
      </SelectTrigger>
      <SelectContent
        sideOffset={4}
        className={cn(
          popupClass,
          'max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto p-1',
        )}
      >
        {props.spec.options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className={cn(itemClass, 'pe-8')}
          >
            {option.label}
            <SelectItemIndicator className="absolute end-2 flex items-center">
              <CheckIcon className="size-4" />
            </SelectItemIndicator>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** A single choice from a short list of strings, styled like the other controls. */
function ChoiceSelect({
  value,
  options,
  onValueChange,
  disabled,
  className,
  ...props
}: {
  value: string | null;
  options: readonly { value: string; label: string }[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      items={options.map((option) => ({ ...option }))}
      onValueChange={(next) => {
        if (typeof next === 'string') onValueChange(next);
      }}
    >
      <SelectTrigger
        aria-label={props['aria-label']}
        className={cn(
          fieldClass,
          'flex h-8 items-center justify-between gap-2 text-start',
          className,
        )}
      >
        <SelectValue className="truncate" />
        <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
      </SelectTrigger>
      <SelectContent
        sideOffset={4}
        className={cn(
          popupClass,
          'max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto p-1',
        )}
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            className={cn(itemClass, 'pe-8')}
          >
            {option.label}
            <SelectItemIndicator className="absolute end-2 flex items-center">
              <CheckIcon className="size-4" />
            </SelectItemIndicator>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const RICH_TEXT_BUTTON =
  'text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium disabled:pointer-events-none disabled:opacity-50';

const RICH_TEXT_MARKS = [
  { mark: 'bold', label: 'B', title: 'Bold', className: 'font-bold' },
  { mark: 'italic', label: 'I', title: 'Italic', className: 'italic' },
  { mark: 'underline', label: 'U', title: 'Underline', className: 'underline' },
  {
    mark: 'strike',
    label: 'S',
    title: 'Strikethrough',
    className: 'line-through',
  },
] as const;

/**
 * Rich text with a formatting toolbar; `suggest` adds completion (for
 * example `{{variables}}`). The editor comes from `Editor.Root richText`
 * (loaded on first focus); without it the field shows its formatted text
 * read-only.
 */
function RichTextField({
  suggest,
  ...props
}: FieldControlProps<'richText'> & {
  suggest?: React.ComponentProps<typeof Editor.RichTextField>['suggest'];
}) {
  const marks = props.spec.marks;
  return (
    <Editor.RichTextField
      suggest={suggest}
      className="border-input focus-within:ring-ring/50 focus-within:border-ring dark:bg-input/30 rounded-md border bg-transparent shadow-xs focus-within:ring-[3px] data-[invalid]:border-destructive [&_[contenteditable]]:min-h-24 [&_[contenteditable]]:px-3 [&_[contenteditable]]:py-2 [&_[contenteditable]]:outline-none [&_[data-editor-richtext-hint]]:text-muted-foreground [&_[data-editor-richtext-hint]]:px-3 [&_[data-editor-richtext-hint]]:pb-2 [&_[data-editor-richtext-hint]]:text-xs [&_[data-editor-richtext-suggestions]]:bg-popover [&_[data-editor-richtext-suggestions]]:z-50 [&_[data-editor-richtext-suggestions]]:min-w-48 [&_[data-editor-richtext-suggestions]]:rounded-md [&_[data-editor-richtext-suggestions]]:border [&_[data-editor-richtext-suggestions]]:p-1 [&_[data-editor-richtext-suggestions]]:shadow-md [&_[role=option]]:flex [&_[role=option]]:cursor-default [&_[role=option]]:justify-between [&_[role=option]]:gap-4 [&_[role=option]]:rounded-sm [&_[role=option]]:px-2 [&_[role=option]]:py-1.5 [&_[role=option]]:text-sm [&_[role=option][data-highlighted]]:bg-accent"
    >
      <Editor.RichTextToolbar className="border-input flex flex-wrap gap-1 border-b p-1">
        {RICH_TEXT_MARKS.filter(
          (item) => marks === undefined || marks.includes(item.mark),
        ).map((item) => (
          <Editor.RichTextToolbarButton
            key={item.mark}
            mark={item.mark}
            aria-label={item.title}
            title={item.title}
            className={`${RICH_TEXT_BUTTON} ${item.className}`}
          >
            {item.label}
          </Editor.RichTextToolbarButton>
        ))}
        {props.spec.inline ? null : (
          <>
            <Editor.RichTextToolbarButton
              node="heading"
              attrs={{ level: 2 }}
              aria-label="Heading"
              title="Heading"
              className={RICH_TEXT_BUTTON}
            >
              H2
            </Editor.RichTextToolbarButton>
            <Editor.RichTextToolbarButton
              node="bulletList"
              aria-label="Bulleted list"
              title="Bulleted list"
              className={RICH_TEXT_BUTTON}
            >
              •
            </Editor.RichTextToolbarButton>
            <Editor.RichTextToolbarButton
              node="orderedList"
              aria-label="Numbered list"
              title="Numbered list"
              className={RICH_TEXT_BUTTON}
            >
              1.
            </Editor.RichTextToolbarButton>
          </>
        )}
      </Editor.RichTextToolbar>
    </Editor.RichTextField>
  );
}

function ListField(props: FieldControlProps<'list'>) {
  const items = props.value ?? [];
  const { min = 0, max = Number.POSITIVE_INFINITY } = props.spec;
  const label = props.spec.label ?? props.name;
  const locked = props.disabled || props.readOnly;
  const update = (next: unknown[]) => props.onChange(next);
  const swap = (from: number, to: number) => {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (moved !== undefined) next.splice(to, 0, moved);
    update(next);
  };

  return (
    <div
      id={props.id}
      role="group"
      data-slot="editor-list"
      className="flex flex-col gap-2"
      {...fieldAria(props)}
    >
      <ol className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li
            key={index}
            className="border-border flex flex-col gap-2 rounded-md border p-2"
          >
            {props.renderElement?.({
              spec: { ...props.spec.of, label: `${label} ${index + 1}` },
              value: item,
              onChange: (next) => {
                const copy = [...items];
                copy[index] = next;
                update(copy);
              },
              id: `${props.id}-${index}`,
              name: `${props.name}[${index}]`,
              index,
              disabled: props.disabled,
              readOnly: props.readOnly,
              invalid: false,
              describedBy: undefined,
            })}
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                variant="outline"
                size="xs"
                aria-label={`Move ${label} ${index + 1} up`}
                disabled={locked || index === 0}
                onClick={() => swap(index, index - 1)}
              >
                Up
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                aria-label={`Move ${label} ${index + 1} down`}
                disabled={locked || index === items.length - 1}
                onClick={() => swap(index, index + 1)}
              >
                Down
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                aria-label={`Remove ${label} ${index + 1}`}
                disabled={locked || items.length <= min}
                onClick={() => update(items.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Add ${label}`}
        disabled={locked || items.length >= max}
        onClick={() => update([...items, emptyListElement(props.spec.of)])}
      >
        Add
      </Button>
    </div>
  );
}

function ObjectField(props: FieldControlProps<'object'>) {
  const value = props.value ?? {};
  return (
    <div
      id={props.id}
      role="group"
      data-slot="editor-object"
      className="border-border flex flex-col gap-3 rounded-md border p-3"
      {...fieldAria(props)}
    >
      {Object.entries(props.spec.fields).map(([key, spec]) => (
        <div key={key} className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{spec.label ?? key}</span>
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
        </div>
      ))}
    </div>
  );
}

/** UI SDK controls for the built-in field kinds, for `Editor.Root fields`. */
const fieldControls = {
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

export {
  ChoiceSelect,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  RichTextField,
  fieldAria,
  fieldControls,
};

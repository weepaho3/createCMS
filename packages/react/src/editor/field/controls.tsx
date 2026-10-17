import type { Field } from '../core/schema';
import type { FieldControlProps, FieldControls } from './types';

import { defaultValuesFor } from '../core/schema';

/** ISO-8601 datetime to the `datetime-local` input format (local time, minutes precision); `''` for missing/invalid input. */
export function toDatetimeLocal(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `datetime-local` input value (local time) to an ISO-8601 UTC string; `undefined` for an empty or invalid input. */
export function fromDatetimeLocal(local: string): string | undefined {
  if (local === '') return undefined;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * The value a freshly added list element starts with, per element kind:
 * neutral scalars, the first option, `[]` for lists and multiple selects,
 * the neutral nested props for objects, `null` for kinds without a neutral
 * value (`date`, `color`, `media`, `reference`, `link`, `custom`).
 */
export function emptyListElement(of: Field): unknown {
  switch (of.type) {
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'select':
      return of.multiple ? [] : (of.options[0]?.value ?? '');
    case 'text':
    case 'textarea':
    case 'richText':
      return '';
    case 'list':
      return [];
    case 'object':
      return defaultValuesFor(of, { fillDefaults: true });
    case 'date':
    case 'color':
    case 'media':
    case 'reference':
    case 'link':
    case 'custom':
      return null;
  }
}

function aria(props: {
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  readOnly: boolean;
}) {
  return {
    'aria-describedby': props.describedBy,
    'aria-invalid': props.invalid || undefined,
    'aria-required': props.required || undefined,
    'aria-readonly': props.readOnly || undefined,
  } as const;
}

export function TextControl(props: FieldControlProps<'text'>) {
  return (
    <input
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
      {...aria(props)}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  );
}

export function TextareaControl(props: FieldControlProps<'textarea'>) {
  return (
    <textarea
      id={props.id}
      name={props.name}
      value={props.value ?? ''}
      placeholder={props.spec.placeholder}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      minLength={props.spec.minLength}
      maxLength={props.spec.maxLength}
      {...aria(props)}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  );
}

/** The value is an HTML string; the textarea edits it as source. */
export function RichTextControl(props: FieldControlProps<'richText'>) {
  return (
    <textarea
      id={props.id}
      name={props.name}
      value={props.value ?? ''}
      placeholder={props.spec.placeholder}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      {...aria(props)}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  );
}

export function ColorControl(props: FieldControlProps<'color'>) {
  return (
    <input
      type="color"
      id={props.id}
      name={props.name}
      value={props.value ?? '#000000'}
      required={props.required}
      disabled={props.disabled || props.readOnly}
      {...aria(props)}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  );
}

export function NumberControl(props: FieldControlProps<'number'>) {
  return (
    <input
      type="number"
      id={props.id}
      name={props.name}
      value={props.value ?? ''}
      placeholder={props.spec.placeholder}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      min={props.spec.min}
      max={props.spec.max}
      step={props.spec.step}
      {...aria(props)}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        props.onChange(raw === '' ? undefined : Number(raw));
      }}
    />
  );
}

export function BooleanControl(props: FieldControlProps<'boolean'>) {
  return (
    <input
      type="checkbox"
      id={props.id}
      name={props.name}
      checked={props.value ?? false}
      required={props.required}
      disabled={props.disabled || props.readOnly}
      {...aria(props)}
      onChange={(event) => props.onChange(event.currentTarget.checked)}
    />
  );
}

export function DateControl(props: FieldControlProps<'date'>) {
  return (
    <input
      type="datetime-local"
      id={props.id}
      name={props.name}
      value={toDatetimeLocal(props.value)}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      {...aria(props)}
      onChange={(event) =>
        props.onChange(fromDatetimeLocal(event.currentTarget.value))
      }
    />
  );
}

export function SelectControl(props: FieldControlProps<'select'>) {
  if (props.spec.multiple) {
    const selected = Array.isArray(props.value) ? props.value : [];
    return (
      <select
        multiple
        id={props.id}
        name={props.name}
        value={selected}
        required={props.required}
        disabled={props.disabled || props.readOnly}
        {...aria(props)}
        onChange={(event) =>
          props.onChange(
            Array.from(event.currentTarget.options)
              .filter((option) => option.selected)
              .map((option) => option.value),
          )
        }
      >
        {props.spec.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <select
      id={props.id}
      name={props.name}
      value={typeof props.value === 'string' ? props.value : ''}
      required={props.required}
      disabled={props.disabled || props.readOnly}
      {...aria(props)}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        props.onChange(raw === '' ? undefined : raw);
      }}
    >
      <option value="">{props.spec.placeholder ?? ''}</option>
      {props.spec.options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Generic list: one row per element (its control from `renderElement`, then
 * Move up / Move down / Remove), an Add button after the rows. `min`/`max`
 * disable Remove/Add at the bounds. Without `renderElement` the rows show
 * nothing (Editor.FieldControl always passes one).
 */
export function ListControl(props: FieldControlProps<'list'>) {
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
    <div id={props.id} role="group" {...aria(props)}>
      <ol>
        {items.map((item, index) => (
          <li key={index}>
            {props.renderElement?.({
              spec: {
                ...props.spec.of,
                label: `${label} ${index + 1}`,
              },
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
            <button
              type="button"
              aria-label={`Move ${label} ${index + 1} up`}
              disabled={locked || index === 0}
              onClick={() => swap(index, index - 1)}
            >
              Move up
            </button>
            <button
              type="button"
              aria-label={`Move ${label} ${index + 1} down`}
              disabled={locked || index === items.length - 1}
              onClick={() => swap(index, index + 1)}
            >
              Move down
            </button>
            <button
              type="button"
              aria-label={`Remove ${label} ${index + 1}`}
              disabled={locked || items.length <= min}
              onClick={() => update(items.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        aria-label={`Add ${label}`}
        disabled={locked || items.length >= max}
        onClick={() => update([...items, emptyListElement(props.spec.of)])}
      >
        Add
      </button>
    </div>
  );
}

/**
 * Generic object: one nested control per field of `spec.fields`, rendered
 * through `renderNested` (Editor.FieldControl always passes one) inside a
 * group labelled by the field.
 */
export function ObjectControl(props: FieldControlProps<'object'>) {
  const value = props.value ?? {};
  return (
    <div id={props.id} role="group" {...aria(props)}>
      {Object.entries(props.spec.fields).map(([key, spec]) => (
        <div key={key} data-field-key={key}>
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

/** The built-in headless controls; `media`, `reference`, `link` and `custom` have none. */
export const defaultFieldControls: FieldControls = {
  text: TextControl,
  textarea: TextareaControl,
  richText: RichTextControl,
  number: NumberControl,
  boolean: BooleanControl,
  date: DateControl,
  color: ColorControl,
  select: SelectControl,
  list: ListControl,
  object: ObjectControl,
};

import type { ListElementSpec } from '@createcms/schema';

import type { FieldControlProps, FieldControls } from './types';

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

/** The value a freshly added list element starts with, per element kind. */
export function emptyListElement(
  of: ListElementSpec,
): string | number | boolean {
  switch (of.type) {
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'select':
      return of.options[0]?.value ?? '';
    default:
      return '';
  }
}

function aria(props: {
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}) {
  return {
    'aria-describedby': props.describedBy,
    'aria-invalid': props.invalid || undefined,
    'aria-required': props.required || undefined,
  } as const;
}

export function StringControl(props: FieldControlProps<'string'>) {
  return (
    <input
      type="text"
      id={props.id}
      name={props.name}
      value={props.value ?? ''}
      placeholder={props.spec.placeholder}
      required={props.required}
      disabled={props.disabled}
      minLength={props.spec.minLength}
      maxLength={props.spec.maxLength}
      {...aria(props)}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  );
}

export function RichTextControl(props: FieldControlProps<'richText'>) {
  return (
    <textarea
      id={props.id}
      name={props.name}
      value={props.value ?? ''}
      placeholder={props.spec.placeholder}
      required={props.required}
      disabled={props.disabled}
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
      min={props.spec.min}
      max={props.spec.max}
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
      disabled={props.disabled}
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
      {...aria(props)}
      onChange={(event) =>
        props.onChange(fromDatetimeLocal(event.currentTarget.value))
      }
    />
  );
}

export function SelectControl(props: FieldControlProps<'select'>) {
  return (
    <select
      id={props.id}
      name={props.name}
      value={props.value ?? ''}
      required={props.required}
      disabled={props.disabled}
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
  const update = (next: Array<string | number | boolean>) =>
    props.onChange(next);
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
                label: `${props.spec.label} ${index + 1}`,
              },
              value: item,
              onChange: (next) => {
                const copy = [...items];
                // Element controls hand back `unknown`; the list's element type is the wide scalar union.
                copy[index] = next as string | number | boolean;
                update(copy);
              },
              id: `${props.id}-${index}`,
              name: `${props.name}[${index}]`,
              index,
              disabled: props.disabled,
              invalid: false,
              describedBy: undefined,
            })}
            <button
              type="button"
              aria-label={`Move ${props.spec.label} ${index + 1} up`}
              disabled={props.disabled || index === 0}
              onClick={() => swap(index, index - 1)}
            >
              Move up
            </button>
            <button
              type="button"
              aria-label={`Move ${props.spec.label} ${index + 1} down`}
              disabled={props.disabled || index === items.length - 1}
              onClick={() => swap(index, index + 1)}
            >
              Move down
            </button>
            <button
              type="button"
              aria-label={`Remove ${props.spec.label} ${index + 1}`}
              disabled={props.disabled || items.length <= min}
              onClick={() => update(items.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        aria-label={`Add ${props.spec.label}`}
        disabled={props.disabled || items.length >= max}
        onClick={() => update([...items, emptyListElement(props.spec.of)])}
      >
        Add
      </button>
    </div>
  );
}

/** The built-in headless controls; `image`, `reference` and `link` have none. */
export const defaultFieldControls: FieldControls = {
  string: StringControl,
  richText: RichTextControl,
  number: NumberControl,
  boolean: BooleanControl,
  date: DateControl,
  select: SelectControl,
  list: ListControl,
};

import type * as React from 'react';

import type {
  Field,
  FieldError,
  FieldKind,
  FieldSpecOf,
  FieldValueOf,
} from '../core/schema';

/** What every control receives besides its spec and value. */
type ControlBase = {
  id: string;
  name: string;
  required: boolean;
  disabled: boolean;
  /** The field is shown but not editable (`readOnly` in the schema). */
  readOnly: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  /** Set for `list` fields: renders one element through the same map/defaults. */
  renderElement?: ListElementRender;
  /** Set for `object` fields: renders one nested field through the same map/defaults. */
  renderNested?: NestedFieldRender;
};

/**
 * Props every field control receives, typed per kind: `spec` is the kind's
 * field (`select` carries `options`, `list` carries `of`), `value` its wide
 * runtime value or `undefined`, `onChange(undefined)` clears the prop.
 * `describedBy` and `invalid` come from `Editor.FieldControl`; a control
 * sets `aria-describedby={describedBy}`, `aria-invalid={invalid || undefined}`,
 * `aria-required={required || undefined}` and `aria-readonly={readOnly ||
 * undefined}` on its focusable element.
 */
export type FieldControlProps<K extends FieldKind = FieldKind> = ControlBase & {
  spec: FieldSpecOf<K>;
  value: FieldValueOf<K> | undefined;
  onChange: (next: FieldValueOf<K> | undefined) => void;
};

/** The wide form `Editor.FieldControl` resolves controls with (any kind, unknown value). */
export type AnyFieldControlProps = ControlBase & {
  spec: Field;
  value: unknown;
  onChange: (next: unknown) => void;
};

/** Props of one list element's control: the element field with a label, plus its index. */
export type ListElementControlProps = {
  spec: Field;
  value: unknown;
  onChange: (next: unknown) => void;
  id: string;
  name: string;
  index: number;
  disabled: boolean;
  readOnly: boolean;
  invalid: boolean;
  describedBy: string | undefined;
};

/** Renders one list element through the same map/defaults as a top-level field. */
export type ListElementRender = (
  props: ListElementControlProps,
) => React.ReactElement | null;

/** Props of one nested field of an `object` value. */
export type NestedFieldControlProps = {
  spec: Field;
  /** The nested field's key inside the object. */
  fieldKey: string;
  value: unknown;
  onChange: (next: unknown) => void;
  id: string;
  name: string;
  disabled: boolean;
  readOnly: boolean;
  invalid: boolean;
  describedBy: string | undefined;
};

/** Renders one nested field of an `object` through the same map/defaults. */
export type NestedFieldRender = (
  props: NestedFieldControlProps,
) => React.ReactElement | null;

/**
 * The `fields` map given to `Editor.Root`: one control component per kind,
 * typed with that kind's props, and for `custom` fields one control per
 * custom `kind` name. Kinds without an entry use the built-in default;
 * `media`, `reference`, `link` and `custom` have no default.
 */
export type FieldControls = {
  [K in Exclude<FieldKind, 'custom'>]?: React.ComponentType<
    FieldControlProps<K>
  >;
} & {
  custom?: Readonly<
    Record<string, React.ComponentType<FieldControlProps<'custom'>>>
  >;
};

/** What `Editor.Field` shares with the parts below it. */
export type FieldContextValue = {
  readonly blockId: string;
  readonly name: string;
  readonly spec: Field;
  readonly value: unknown;
  /** Writes the prop (`undefined` clears it); coalesces rapid writes into one undo step. */
  readonly setValue: (next: unknown) => void;
  /** Id of the control element (`FieldLabel` points at it). */
  readonly id: string;
  readonly descriptionId: string;
  readonly errorId: string;
  /** Space-joined ids of the mounted description and (while invalid) error, or `undefined`. */
  readonly describedBy: string | undefined;
  readonly required: boolean;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly invalid: boolean;
  readonly errors: readonly FieldError[];
  /** True while this field is the store's focused field for the local user. */
  readonly focused: boolean;
  /** Registers a describing element while mounted; returns the unregister function. */
  readonly registerDescribedBy: (id: string) => () => void;
};

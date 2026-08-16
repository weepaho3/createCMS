import type { BlockProperty, ListElementType } from '@createcms/schema';
import type * as React from 'react';

import type {
  FieldError,
  FieldKind,
  FieldSpecOf,
  FieldValueOf,
} from '../schema';

/**
 * Props every field control receives, typed per kind: `spec` is the kind's
 * spec (`select` carries `options`, `list` carries `of`), `value` its wide
 * runtime value or `undefined`, `onChange(undefined)` clears the property.
 * `describedBy` and `invalid` come from `Editor.FieldControl`; a control
 * sets `aria-describedby={describedBy}`, `aria-invalid={invalid || undefined}`
 * and `aria-required={required || undefined}` (absent when not required)
 * on its focusable element. `renderElement` is set for `list` only.
 */
export type FieldControlProps<K extends FieldKind = FieldKind> = {
  spec: FieldSpecOf<K>;
  value: FieldValueOf<K> | undefined;
  onChange: (next: FieldValueOf<K> | undefined) => void;
  id: string;
  name: string;
  required: boolean;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  renderElement?: ListElementRender;
};

/** The wide form `Editor.FieldControl` resolves controls with (any kind, unknown value). */
export type AnyFieldControlProps = {
  spec: BlockProperty;
  value: unknown;
  onChange: (next: unknown) => void;
  id: string;
  name: string;
  required: boolean;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  renderElement?: ListElementRender;
};

/** Props of one list element's control: the element spec widened to a labelled spec, plus its index. */
export type ListElementControlProps = {
  spec: FieldSpecOf<ListElementType>;
  value: unknown;
  onChange: (next: unknown) => void;
  id: string;
  name: string;
  index: number;
  disabled: boolean;
  invalid: boolean;
  describedBy: string | undefined;
};

/** Renders one list element through the same map/defaults as a top-level field. */
export type ListElementRender = (
  props: ListElementControlProps,
) => React.ReactElement | null;

/**
 * The `fields` map given to `Editor.Root`: one control component per kind,
 * typed with that kind's props. Kinds without an entry use the built-in
 * default; `image`, `reference` and `link` have no default.
 */
export type FieldControls = {
  [K in FieldKind]?: React.ComponentType<FieldControlProps<K>>;
};

/** What `Editor.Field` shares with the parts below it. */
export type FieldContextValue = {
  readonly blockId: string;
  readonly name: string;
  readonly spec: BlockProperty;
  readonly value: unknown;
  /** Writes the property (`undefined` clears it); coalesces rapid writes into one undo step. */
  readonly setValue: (next: unknown) => void;
  /** Id of the control element (`FieldLabel` points at it). */
  readonly id: string;
  readonly descriptionId: string;
  readonly errorId: string;
  /** Space-joined ids of the mounted description and (while invalid) error, or `undefined`. */
  readonly describedBy: string | undefined;
  readonly required: boolean;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly errors: readonly FieldError[];
  /** True while this field is the store's focused field for the local user. */
  readonly focused: boolean;
  /** Registers a describing element while mounted; returns the unregister function. */
  readonly registerDescribedBy: (id: string) => () => void;
};

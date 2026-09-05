import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { FieldKind } from '../schema';
import type {
  AnyFieldControlProps,
  FieldContextValue,
  ListElementRender,
} from './types';

import { composeRefs, useRender } from '../../use-render';
import { useEditorSelector } from '../binding';
import { useEditorContext } from '../context';
import { useAnyField, useFields } from '../hooks';
import { groupFields, validateField } from '../schema';
import { scrollElementIntoView } from '../scroll';
import { FieldContext, useFieldContext } from './context';
import { defaultFieldControls } from './controls';

const warned = new Set<string>();

/** Dev-only console warning, emitted once per distinct message for the lifetime of the module. */
function warnOnce(message: string): void {
  if (process.env.NODE_ENV === 'production') return;
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

// --- Editor.Field -----------------------------------------------------------

type FieldState = {
  kind: string;
  required: boolean;
  invalid: boolean;
  disabled: boolean;
  focused: boolean;
};

export type EditorFieldProps = UseRenderComponentProps<'div', FieldState> & {
  /** The block (or root) whose property this field edits. */
  blockId: string;
  /** The property key on that block. */
  name: string;
  /** Disables the control and marks the field `data-disabled`. */
  disabled?: boolean;
};

/**
 * Owns one property of one block: reads its spec and value, validates the
 * value on every change, writes through `setValue` (coalesced into one undo
 * step), mirrors the store's focused field and wires `aria-describedby` for
 * the parts below it. Renders `null` (with a dev warning) for a key the
 * block's type does not declare.
 */
export function EditorField(props: EditorFieldProps) {
  const { blockId, name, disabled = false, render, onFocus, ...rest } = props;
  const ctx = useEditorContext('Editor.Field');
  const field = useAnyField(blockId, name);
  const focused = useEditorSelector((state) => {
    const target = state.selection[ctx.userId]?.focus;
    return (
      target !== null &&
      target !== undefined &&
      target.blockId === blockId &&
      target.key === name
    );
  });
  const reactId = React.useId();
  const id = `${reactId}-control`;
  const descriptionId = `${reactId}-description`;
  const errorId = `${reactId}-error`;
  const [describers, setDescribers] = React.useState<readonly string[]>([]);
  const registerDescribedBy = React.useCallback((describerId: string) => {
    setDescribers((prev) =>
      prev.includes(describerId) ? prev : [...prev, describerId],
    );
    return () =>
      setDescribers((prev) => prev.filter((entry) => entry !== describerId));
  }, []);
  const spec = field.spec;
  const value = field.value;
  const errors = React.useMemo(
    () => (spec ? validateField(spec, value) : []),
    [spec, value],
  );
  const invalid = errors.length > 0;
  const describedBy =
    describers.filter((entry) => entry !== errorId || invalid).join(' ') ||
    undefined;
  const setValue = React.useCallback(
    (next: unknown) => field.set(next, { coalesce: true }),
    [field],
  );
  const contextValue = React.useMemo<FieldContextValue | null>(
    () =>
      spec === undefined
        ? null
        : {
            blockId,
            name,
            spec,
            value,
            setValue,
            id,
            descriptionId,
            errorId,
            describedBy,
            required: spec.required === true,
            disabled,
            invalid,
            errors,
            focused,
            registerDescribedBy,
          },
    [
      blockId,
      name,
      spec,
      value,
      setValue,
      id,
      descriptionId,
      errorId,
      describedBy,
      disabled,
      invalid,
      errors,
      focused,
      registerDescribedBy,
    ],
  );
  const handleFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    onFocus?.(event);
    // `store.focus` closes the coalescing window, so it runs only when the
    // focus actually moves to this field, never on every keystroke.
    if (!focused) ctx.store.focus({ blockId, key: name });
  };
  const element = useRender<'div', FieldState>({
    defaultTagName: 'div',
    props: { ...rest, onFocus: handleFocus },
    render,
    state: {
      kind: spec?.type ?? 'unknown',
      required: spec?.required === true,
      invalid,
      disabled,
      focused,
    },
  });
  if (contextValue === null) {
    warnOnce(
      `Editor.Field: block "${blockId}" declares no property "${name}"; the field renders nothing.`,
    );
    return null;
  }
  return (
    <FieldContext.Provider value={contextValue}>
      {element}
    </FieldContext.Provider>
  );
}

// --- Editor.FieldLabel ------------------------------------------------------

type FieldLabelState = {
  required: boolean;
  invalid: boolean;
  disabled: boolean;
};

export type EditorFieldLabelProps = UseRenderComponentProps<
  'label',
  FieldLabelState
>;

/** A `<label htmlFor>` pointing at the field's control; the spec's `label` unless children are given. */
export function EditorFieldLabel({
  children,
  render,
  ...rest
}: EditorFieldLabelProps) {
  const field = useFieldContext('Editor.FieldLabel');
  return useRender<'label', FieldLabelState>({
    defaultTagName: 'label',
    props: {
      htmlFor: field.id,
      children: children ?? field.spec.label,
      ...rest,
    },
    render,
    state: {
      required: field.required,
      invalid: field.invalid,
      disabled: field.disabled,
    },
  });
}

// --- Editor.FieldDescription ------------------------------------------------

export type EditorFieldDescriptionProps = UseRenderComponentProps<'p'>;

/**
 * The spec's `description` (or children) in a `<p>` the control references
 * through `aria-describedby`. Renders nothing, and registers nothing, when
 * there is no text to show.
 */
export function EditorFieldDescription({
  children,
  render,
  ...rest
}: EditorFieldDescriptionProps) {
  const field = useFieldContext('Editor.FieldDescription');
  const content = children ?? field.spec.description;
  const hasContent = content !== undefined && content !== null;
  const { registerDescribedBy, descriptionId } = field;
  React.useLayoutEffect(() => {
    if (!hasContent) return;
    return registerDescribedBy(descriptionId);
  }, [hasContent, registerDescribedBy, descriptionId]);
  const element = useRender<'p'>({
    defaultTagName: 'p',
    props: { id: descriptionId, children: content, ...rest },
    render,
  });
  return hasContent ? element : null;
}

// --- Editor.FieldError ------------------------------------------------------

type FieldErrorState = { invalid: boolean };

export type EditorFieldErrorProps = UseRenderComponentProps<
  'p',
  FieldErrorState
>;

/**
 * The field's validation messages in a `<p role="alert">`, rendered only
 * while the field is invalid; the control references it through
 * `aria-describedby` for exactly that time. A custom `render` reads the
 * structured findings from `useFieldContext().errors`.
 */
export function EditorFieldError({
  children,
  render,
  ...rest
}: EditorFieldErrorProps) {
  const field = useFieldContext('Editor.FieldError');
  const { registerDescribedBy, errorId } = field;
  React.useLayoutEffect(
    () => registerDescribedBy(errorId),
    [registerDescribedBy, errorId],
  );
  const element = useRender<'p', FieldErrorState>({
    defaultTagName: 'p',
    props: {
      id: errorId,
      role: 'alert',
      children:
        children ?? field.errors.map((error) => error.message).join(' '),
      ...rest,
    },
    render,
    state: { invalid: true },
  });
  return field.invalid ? element : null;
}

// --- Editor.FieldControl ----------------------------------------------------

export type EditorFieldControlProps = {
  /** Replaces the resolved control; receives the props a control component would. */
  render?: (props: AnyFieldControlProps) => React.ReactElement | null;
};

/**
 * Renders the field's control, resolved in this order: the `render` prop,
 * the `fields` map of `Editor.Root`, the built-in default for the kind.
 * `image`, `reference` and `link` have no default: without a map entry the
 * part renders nothing and warns once (dev only). List elements resolve
 * through the same map/defaults via `renderElement`.
 */
export function EditorFieldControl({ render }: EditorFieldControlProps) {
  const ctx = useEditorContext('Editor.FieldControl');
  const field = useFieldContext('Editor.FieldControl');
  const resolve = React.useCallback(
    (kind: FieldKind): React.ComponentType<AnyFieldControlProps> | null => {
      const component = ctx.fields[kind] ?? defaultFieldControls[kind];
      // The map is typed per kind for consumers; this resolver dispatches on
      // the runtime `spec.type`, so the wide props are exactly what that
      // component was declared for.
      return (
        (component as React.ComponentType<AnyFieldControlProps> | undefined) ??
        null
      );
    },
    [ctx.fields],
  );
  const renderElement = React.useCallback<ListElementRender>(
    (props) => {
      const Component = resolve(props.spec.type);
      if (!Component) {
        warnOnce(
          `Editor.FieldControl: no control for list elements of kind "${props.spec.type}"; pass one through Editor.Root's fields prop.`,
        );
        return null;
      }
      return (
        <Component
          spec={props.spec}
          value={props.value}
          onChange={props.onChange}
          id={props.id}
          name={props.name}
          required={false}
          disabled={props.disabled}
          invalid={props.invalid}
          describedBy={props.describedBy}
        />
      );
    },
    [resolve],
  );
  const controlProps: AnyFieldControlProps = {
    spec: field.spec,
    value: field.value,
    onChange: field.setValue,
    id: field.id,
    name: field.name,
    required: field.required,
    disabled: field.disabled,
    invalid: field.invalid,
    describedBy: field.describedBy,
  };
  if (field.spec.type === 'list') controlProps.renderElement = renderElement;
  if (render) return render(controlProps);
  const Component = resolve(field.spec.type);
  if (!Component) {
    warnOnce(
      `Editor.FieldControl: no control for kind "${field.spec.type}" (field "${field.name}"); pass one through Editor.Root's fields prop.`,
    );
    return null;
  }
  return <Component {...controlProps} />;
}

// --- Editor.Form ------------------------------------------------------------

type FormState = { blockType: string | null; blockId: string };

export type EditorFormProps = Omit<
  UseRenderComponentProps<'div', FormState>,
  'children'
> & {
  /** The block (or root) whose declared properties the form edits. */
  blockId: string;
  /** Disables every field of the form. */
  disabled?: boolean;
  /**
   * When true, scrolls this form into view on each store focus change that
   * targets this block (`scrollIntoView` with `block: 'nearest'`).
   */
  autoScroll?: boolean;
};

/**
 * Every declared property of the block as a complete field (label, control,
 * description, error), grouped by the specs' `group`: named groups in a
 * `<fieldset data-group>` with a `<legend>`, ungrouped fields directly.
 * Renders `null` for an unknown block.
 */
export function EditorForm({
  blockId,
  disabled = false,
  autoScroll = false,
  render,
  ...rest
}: EditorFormProps) {
  const ctx = useEditorContext('Editor.Form');
  const elRef = React.useRef<HTMLDivElement | null>(null);
  const blockType = useEditorSelector(
    (state) => state.nodes[blockId]?.type ?? null,
  );
  const fields = useFields(blockId);
  const groups = React.useMemo(
    () =>
      groupFields(
        Object.fromEntries(fields.map((field) => [field.key, field.spec])),
      ),
    [fields],
  );
  // One flat child list: fieldsets keyed by group name, ungrouped fields by
  // property key; the prefixes keep the two key spaces apart.
  const content: React.ReactNode[] = [];
  for (const group of groups) {
    const items = group.fields.map((field) => (
      <EditorField
        key={`field:${field.key}`}
        blockId={blockId}
        name={field.key}
        disabled={disabled}
      >
        <EditorFieldLabel />
        <EditorFieldControl />
        <EditorFieldDescription />
        <EditorFieldError />
      </EditorField>
    ));
    if (group.group === null) {
      content.push(...items);
    } else {
      content.push(
        <fieldset key={`group:${group.group}`} data-group={group.group}>
          <legend>{group.group}</legend>
          {items}
        </fieldset>,
      );
    }
  }
  React.useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    return ctx.registerScrollTarget(blockId, el);
  }, [ctx, blockId, blockType]);
  const focusSig = useEditorSelector((state) => {
    const focus = state.selection[ctx.userId]?.focus;
    return focus && focus.blockId === blockId
      ? `${focus.blockId}:${focus.key}`
      : null;
  });
  React.useLayoutEffect(() => {
    if (!autoScroll || !focusSig || !elRef.current) return;
    scrollElementIntoView(elRef.current);
  }, [autoScroll, focusSig]);
  const element = useRender<'div', FormState>({
    defaultTagName: 'div',
    props: {
      ...rest,
      ref: composeRefs(elRef, rest.ref),
      children: content,
    },
    render,
    state: { blockType, blockId },
  });
  return blockType === null ? null : element;
}

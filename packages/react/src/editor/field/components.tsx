import * as React from 'react';

import type { UseRenderComponentProps } from '../../use-render';
import type { Field } from '../core/schema';
import type {
  AnyFieldControlProps,
  FieldContextValue,
  ListElementRender,
  NestedFieldRender,
} from './types';

import { composeRefs, useRender } from '../../use-render';
import { useDocSelector, useSessionSelector } from '../binding';
import { useEditorContext } from '../context';
import { warnOnce } from '../core/codes';
import { formatIssue } from '../core/messages';
import { groupFields, validateField } from '../core/schema';
import { isHTMLElement } from '../dom';
import { useAnyField, useFields } from '../hooks';
import { useMessages } from '../messages';
import { scrollElementIntoView } from '../scroll';
import { FieldContext, useFieldContext } from './context';
import { defaultFieldControls } from './controls';

// --- Editor.Field -----------------------------------------------------------

const EDITABLE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const FOCUSABLE =
  'input, textarea, select, button, [contenteditable], [tabindex]:not([tabindex="-1"])';

type FieldState = {
  kind: string;
  required: boolean;
  invalid: boolean;
  disabled: boolean;
  readOnly: boolean;
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
 * value (deferred, never blocking input), writes through `setValue` eagerly (coalesced into one undo
 * step), mirrors the store's focused field and wires `aria-describedby` for
 * the parts below it. Renders `null` (with a dev warning) for a key the
 * block's type does not declare.
 */
export function EditorField(props: EditorFieldProps) {
  const {
    blockId,
    name,
    disabled = false,
    render,
    onFocus,
    onPointerEnter,
    onPointerLeave,
    ref,
    ...rest
  } = props;
  const ctx = useEditorContext('Editor.Field');
  const field = useAnyField(blockId, name);
  const focused = useSessionSelector((state) => {
    const target = state.focusedField;
    return target !== null && target.blockId === blockId && target.key === name;
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
  // The write is eager; validation follows the deferred value, so typing
  // never waits for it.
  const validatedValue = React.useDeferredValue(value);
  const errors = React.useMemo(
    () => (spec ? validateField(spec, validatedValue) : []),
    [spec, validatedValue],
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
            readOnly: spec.readOnly === true,
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
  const elRef = React.useRef<HTMLDivElement | null>(null);
  const store = ctx.store;
  // Focus set elsewhere (a click in the canvas or a preview) moves DOM focus
  // into the control. It waits until every listener of the click ran (one
  // of them may start inline editing), and never takes focus from inline
  // editing or from another text input.
  React.useEffect(() => {
    if (!focused) return;
    const timer = setTimeout(() => {
      const el = elRef.current;
      if (!el || store.getSession().editing !== null) return;
      const doc = el.ownerDocument;
      const active = doc.activeElement;
      if (active && el.contains(active)) return;
      if (active?.closest(EDITABLE)) return;
      const control =
        doc.getElementById(id) ?? el.querySelector<HTMLElement>(FOCUSABLE);
      if (!isHTMLElement(control) || !el.contains(control)) return;
      // Focus inside a preview frame stays there until the host window
      // takes it back.
      if (active?.tagName === 'IFRAME') doc.defaultView?.focus();
      control.focus({ preventScroll: true });
      scrollElementIntoView(control);
    }, 0);
    return () => clearTimeout(timer);
  }, [focused, store, id]);
  const element = useRender<'div', FieldState>({
    defaultTagName: 'div',
    props: {
      ...rest,
      ref: composeRefs(elRef, ref),
      onFocus: handleFocus,
      // Pointing at a field highlights its block in the canvas and previews.
      onPointerEnter: (event: React.PointerEvent<HTMLDivElement>) => {
        onPointerEnter?.(event);
        store.hover(blockId);
      },
      onPointerLeave: (event: React.PointerEvent<HTMLDivElement>) => {
        onPointerLeave?.(event);
        if (store.getEphemeral().hoverId === blockId) store.hover(null);
      },
    },
    render,
    state: {
      kind: spec?.type ?? 'unknown',
      required: spec?.required === true,
      invalid,
      disabled,
      readOnly: spec?.readOnly === true,
      focused,
    },
  });
  if (contextValue === null) {
    if (process.env.NODE_ENV !== 'production') {
      warnOnce(
        'E007',
        `Editor.Field: block "${blockId}" declares no property "${name}"; the field renders nothing.`,
      );
    }
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

/** A `<label htmlFor>` pointing at the field's control; the field's `label` (or its key) unless children are given. */
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
      children: children ?? field.spec.label ?? field.name,
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
  const messages = useMessages();
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
        children ??
        field.errors.map((error) => formatIssue(error, messages)).join(' '),
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
 * the `fields` map of `Editor.Root` (`fields.custom[kind]` for a `custom`
 * field), the built-in default for the kind. `media`, `reference`, `link`
 * and `custom` have no default: without a map entry the part renders nothing
 * and warns once (dev only). List elements and the nested fields of an
 * `object` resolve through the same map/defaults.
 */
export function EditorFieldControl({ render }: EditorFieldControlProps) {
  const ctx = useEditorContext('Editor.FieldControl');
  const field = useFieldContext('Editor.FieldControl');
  const resolve = React.useCallback(
    (spec: Field): React.ComponentType<AnyFieldControlProps> | null => {
      // The map is typed per kind for consumers; this resolver dispatches on
      // the runtime `spec.type`, so the wide props are exactly what that
      // component was declared for.
      const component =
        spec.type === 'custom'
          ? ctx.fields.custom?.[spec.kind]
          : (ctx.fields[spec.type] ?? defaultFieldControls[spec.type]);
      return (
        (component as React.ComponentType<AnyFieldControlProps> | undefined) ??
        null
      );
    },
    [ctx.fields],
  );
  const renderWith = React.useCallback(
    (
      spec: Field,
      props: Omit<AnyFieldControlProps, 'spec' | 'required'>,
      what: string,
    ): React.ReactElement | null => {
      const Component = resolve(spec);
      if (!Component) {
        if (process.env.NODE_ENV !== 'production')
          warnOnce(
            'E008',
            `Editor.FieldControl: no control for ${what} of kind "${spec.type === 'custom' ? `custom:${spec.kind}` : spec.type}"; pass one through Editor.Root's fields prop.`,
          );
        return null;
      }
      const nested: AnyFieldControlProps = {
        ...props,
        spec,
        required: spec.required === true,
        readOnly: props.readOnly || spec.readOnly === true,
      };
      if (spec.type === 'list') nested.renderElement = renderElement;
      if (spec.type === 'object') nested.renderNested = renderNested;
      return <Component {...nested} />;
    },
    // renderElement/renderNested are declared below and stable per resolve.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolve],
  );
  const renderElement = React.useCallback<ListElementRender>(
    ({ spec, index: _index, ...props }) =>
      renderWith(spec, props, 'list elements'),
    [renderWith],
  );
  const renderNested = React.useCallback<NestedFieldRender>(
    ({ spec, fieldKey: _fieldKey, ...props }) =>
      renderWith(spec, props, 'nested fields'),
    [renderWith],
  );
  const controlProps: AnyFieldControlProps = {
    spec: field.spec,
    value: field.value,
    onChange: field.setValue,
    id: field.id,
    name: field.name,
    required: field.required,
    disabled: field.disabled,
    readOnly: field.readOnly,
    invalid: field.invalid,
    describedBy: field.describedBy,
  };
  if (field.spec.type === 'list') controlProps.renderElement = renderElement;
  if (field.spec.type === 'object') controlProps.renderNested = renderNested;
  if (render) return render(controlProps);
  const Component = resolve(field.spec);
  if (!Component) {
    if (process.env.NODE_ENV !== 'production')
      warnOnce(
        'E008',
        `Editor.FieldControl: no control for kind "${field.spec.type === 'custom' ? `custom:${field.spec.kind}` : field.spec.type}" (field "${field.name}"); pass one through Editor.Root's fields prop.`,
      );
    return null;
  }
  return <Component {...controlProps} />;
}

// --- Editor.Form ------------------------------------------------------------

type FormState = {
  blockType: string | null;
  blockId: string;
  /** The block's `resolveData` is running. */
  loading: boolean;
  /** The block's `resolveData` failed. */
  error: boolean;
};

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
 * Every visible field of the block as a complete field (label, control,
 * description, error), grouped by the fields' `group`: named groups in a
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
  const blockType = useDocSelector(
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
  const focusSig = useSessionSelector((state) => {
    const focus = state.focusedField;
    return focus && focus.blockId === blockId
      ? `${focus.blockId}:${focus.key}`
      : null;
  });
  React.useLayoutEffect(() => {
    if (!autoScroll || !focusSig || !elRef.current) return;
    scrollElementIntoView(elRef.current);
  }, [autoScroll, focusSig]);
  const status = useSessionSelector(
    (state) => state.nodeStatus[blockId] ?? null,
  );
  const element = useRender<'div', FormState>({
    defaultTagName: 'div',
    props: {
      ...rest,
      ref: composeRefs(elRef, rest.ref),
      children: content,
    },
    render,
    state: {
      blockType,
      blockId,
      loading: status !== null && status.loading,
      error: status?.error != null,
    },
  });
  return blockType === null ? null : element;
}

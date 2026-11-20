// @registry ui-sdk-editor@0.3.2
'use client';

import type { Field as FieldSpec } from '@createcms/react/editor/core';

import {
  describeBlock,
  Editor,
  useDocSelector,
  useEditor,
  useEditorContext,
  useEditorStore,
  useFieldContext,
  useFields,
  useMessages,
  useNodeStatus,
  useSelection,
  useSessionSelector,
  useSlot,
  useSlots,
} from '@createcms/react/editor';
import { formatIssue, groupFields } from '@createcms/react/editor/core';
import { Button } from '@ui-sdk/react/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@ui-sdk/react/field';
import { ChevronRightIcon } from 'lucide-react';
import * as React from 'react';

import { Chrome } from './chrome';

const grouped = (spec: FieldSpec) =>
  spec.type === 'list' ||
  spec.type === 'object' ||
  spec.type === 'link' ||
  spec.type === 'media' ||
  (spec.type === 'select' && spec.multiple === true);

function FieldBody() {
  const field = useFieldContext('Form');
  const messages = useMessages();
  const label = field.spec.label ?? field.name;
  const error = field.errors
    .map((issue) => formatIssue(issue, messages))
    .join(' ');
  if (grouped(field.spec)) {
    return (
      <>
        <FieldLegend className="ed-label">{label}</FieldLegend>
        {field.spec.description ? (
          <FieldDescription className="ed-description">
            {field.spec.description}
          </FieldDescription>
        ) : null}
        <Editor.FieldControl />
        {field.invalid ? (
          <FieldDescription className="ed-error">{error}</FieldDescription>
        ) : null}
      </>
    );
  }
  const boolean = field.spec.type === 'boolean';
  return (
    <>
      {boolean ? null : <FieldLabel className="ed-label">{label}</FieldLabel>}
      <Editor.FieldControl />
      {boolean ? <FieldLabel className="ed-label">{label}</FieldLabel> : null}
      {field.spec.description ? (
        <FieldDescription className="ed-description">
          {field.spec.description}
        </FieldDescription>
      ) : null}
      {field.invalid ? (
        <FieldError match className="ed-error">
          {error}
        </FieldError>
      ) : null}
    </>
  );
}

function FormField({
  blockId,
  name,
  spec,
  disabled,
}: {
  blockId: string;
  name: string;
  spec: FieldSpec;
  disabled: boolean;
}) {
  if (grouped(spec)) {
    return (
      <Editor.Field blockId={blockId} name={name} disabled={disabled}>
        <FieldSet disabled={disabled} className="ed-field">
          <FieldBody />
        </FieldSet>
      </Editor.Field>
    );
  }
  return (
    <Editor.Field
      blockId={blockId}
      name={name}
      disabled={disabled}
      render={(props, state) => (
        <Field
          {...props}
          invalid={state.invalid}
          disabled={state.disabled}
          className="ed-field"
        />
      )}
    >
      <FieldBody />
    </Editor.Field>
  );
}

export function Form({
  blockId,
  disabled = false,
  autoScroll = false,
}: {
  blockId: string;
  disabled?: boolean;
  autoScroll?: boolean;
}) {
  const ctx = useEditorContext('Form');
  const { loading, error } = useNodeStatus(blockId);
  const fields = useFields(blockId);
  const groups = React.useMemo(
    () => groupFields(Object.fromEntries(fields.map((f) => [f.key, f.spec]))),
    [fields],
  );
  const el = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    if (!el.current) return;
    return ctx.registerScrollTarget(blockId, el.current);
  }, [ctx, blockId]);
  const focused = useSessionSelector((state) => {
    const focus = state.focusedField;
    return focus && focus.blockId === blockId ? focus.key : null;
  });
  React.useLayoutEffect(() => {
    if (autoScroll && focused) el.current?.scrollIntoView({ block: 'nearest' });
  }, [autoScroll, focused]);

  const field = (key: string, spec: FieldSpec) => (
    <FormField
      key={key}
      blockId={blockId}
      name={key}
      spec={spec}
      disabled={disabled}
    />
  );

  return (
    <>
      {error ? (
        <p role="alert" className="ed-note" data-tone="error">
          {error.message}
        </p>
      ) : loading ? (
        <p aria-live="polite" className="ed-note">
          Loading…
        </p>
      ) : null}
      <Chrome.Form ref={el} className="ed-form">
        {groups.map((group) =>
          group.group === null ? (
            group.fields.map((f) => field(f.key, f.spec))
          ) : (
            <FieldSet key={`group:${group.group}`} className="ed-group-set">
              <FieldLegend className="ed-group-legend">
                {group.group}
              </FieldLegend>
              {group.fields.map((f) => field(f.key, f.spec))}
            </FieldSet>
          ),
        )}
      </Chrome.Form>
    </>
  );
}

function useLabel(blockId: string): string {
  const { schema } = useEditorContext('FormSurface');
  return useDocSelector((doc) => {
    const node = doc.nodes[blockId];
    return !node || blockId === doc.rootId
      ? 'Page'
      : describeBlock(schema, node).label;
  });
}

function PathButton({
  blockId,
  onPress,
}: {
  blockId: string;
  onPress: () => void;
}) {
  const label = useLabel(blockId);
  return (
    <Button
      className="ed-link"
      aria-label={`Back to ${label}`}
      onClick={onPress}
    >
      {label}
    </Button>
  );
}

function Path({ blockId }: { blockId: string }) {
  const store = useEditorStore();
  const ancestors = useDocSelector(
    (doc) => {
      const ids: string[] = [];
      for (let id = doc.nodes[blockId]?.parent?.id; id;) {
        ids.unshift(id);
        id = doc.nodes[id]?.parent?.id;
      }
      return ids;
    },
    (a, b) => a.join() === b.join(),
  );
  if (ancestors.length === 0) return null;
  return (
    <Chrome.FormBreadcrumb>
      <ol className="ed-path">
        {ancestors.map((id, index) => (
          <li key={id}>
            <PathButton
              blockId={id}
              onPress={() => store.select(index === 0 ? null : id)}
            />
            <ChevronRightIcon aria-hidden />
          </li>
        ))}
      </ol>
    </Chrome.FormBreadcrumb>
  );
}

function Child({ blockId }: { blockId: string }) {
  const store = useEditorStore();
  const { schema } = useEditorContext('FormSurface');
  const summary = useDocSelector((doc) => {
    const node = doc.nodes[blockId];
    if (!node) return null;
    const { label, excerpt } = describeBlock(schema, node);
    const count = Object.values(node.slots).reduce(
      (n, ids) => n + ids.length,
      0,
    );
    return `${label}\u0000${excerpt ?? ''}\u0000${count}`;
  });
  if (!summary) return null;
  const [label, excerpt, count] = summary.split('\u0000');
  return (
    <Chrome.FormChild>
      <Button className="ed-child" onClick={() => store.select(blockId)}>
        <span className="ed-child-text">
          <span className="ed-child-label">{label}</span>
          {excerpt ? <span className="ed-muted">{excerpt}</span> : null}
        </span>
        {count !== '0' ? (
          <span className="ed-muted">{count} inside</span>
        ) : null}
        <ChevronRightIcon aria-hidden />
      </Button>
    </Chrome.FormChild>
  );
}

function Slot({ blockId, slot }: { blockId: string; slot: string }) {
  const children = useSlot(blockId, slot);
  const { schema } = useEditorContext('FormSurface');
  const type = useDocSelector((doc) => doc.nodes[blockId]?.type);
  const spec =
    type === 'root'
      ? schema.root.slots?.[slot]
      : type
        ? schema.components[type]?.slots?.[slot]
        : undefined;
  const heading = spec?.label ?? (slot === 'children' ? 'Content' : slot);
  return (
    <section className="ed-slot">
      <h2>{heading}</h2>
      {children.length === 0 ? (
        <p className="ed-empty">
          Empty. Add blocks from the palette while this block is selected.
        </p>
      ) : (
        <ul>
          {children.map((child) => (
            <Child key={child.id} blockId={child.id} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function FormSurface({ children }: { children?: React.ReactNode }) {
  const rootId = useEditor((state) => state.rootId);
  const blockId = useSelection().selected ?? rootId;
  const label = useLabel(blockId);
  const slots = useSlots(blockId);
  const hasFields = useFields(blockId).length > 0;
  return (
    <Chrome.FormSurface className="ed-form-surface">
      <Path blockId={blockId} />
      <h1>{label}</h1>
      {hasFields ? <Form blockId={blockId} /> : null}
      {slots.map((slot) => (
        <Slot key={slot} blockId={blockId} slot={slot} />
      ))}
      {children}
    </Chrome.FormSurface>
  );
}

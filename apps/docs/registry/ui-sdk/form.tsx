// @registry ui-sdk-editor@0.3.2
'use client';

// The form of one block, and the form-only surface: the path to the block,
// its fields and its nested blocks per slot, so every block is reachable
// without a canvas.

import {
  describeBlock,
  Editor,
  useDocSelector,
  useEditor,
  useEditorContext,
  useEditorStore,
  useFields,
  useNodeStatus,
  useSelection,
  useSlot,
  useSlots,
} from '@createcms/react/editor';
import { Button } from '@ui-sdk/react/button';
import { ChevronRightIcon } from 'lucide-react';
import * as React from 'react';

/** The fields of a block, after its `resolveData` state. */
export function Form(props: React.ComponentProps<typeof Editor.Form>) {
  const { loading, error } = useNodeStatus(props.blockId);
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
      <Editor.Form data-slot="editor-form" {...props} />
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

function Label({ blockId }: { blockId: string }) {
  return <>{useLabel(blockId)}</>;
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
    <nav aria-label="Block path" data-slot="editor-form-breadcrumb">
      <ol className="ed-path">
        {ancestors.map((id, index) => (
          <li key={id}>
            <Button
              className="ed-link"
              onClick={() => store.select(index === 0 ? null : id)}
            >
              <Label blockId={id} />
            </Button>
            <ChevronRightIcon aria-hidden />
          </li>
        ))}
      </ol>
    </nav>
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
    <li data-slot="editor-form-child">
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
    </li>
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

/** The form-only edit surface: the selection's form, or the page's. */
export function FormSurface({ children }: { children?: React.ReactNode }) {
  const rootId = useEditor((state) => state.rootId);
  const blockId = useSelection().selected ?? rootId;
  const label = useLabel(blockId);
  const slots = useSlots(blockId);
  const hasFields = useFields(blockId).length > 0;
  return (
    <div data-slot="editor-form-surface" className="ed-form-surface">
      <Path blockId={blockId} />
      <h1>{label}</h1>
      {hasFields ? <Form blockId={blockId} /> : null}
      {slots.map((slot) => (
        <Slot key={slot} blockId={blockId} slot={slot} />
      ))}
      {children}
    </div>
  );
}

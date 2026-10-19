// @registry editor-form@0.3.2
'use client';

// The styled form of one block and the form-only edit surface. Does not wrap
// Editor.Root. Field controls for createCMS data (assets, references, links,
// variables) come from editor-form-createcms.

import type * as React from 'react';

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
import { ChevronRightIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

function Form({
  className,
  ...props
}: React.ComponentProps<typeof Editor.Form>) {
  return (
    <>
      <NodeStatusNote blockId={props.blockId} />
      <Editor.Form
        data-slot="editor-form"
        className={cn(
          'flex flex-col gap-4',
          '[&>div]:flex [&>div]:flex-col [&>div]:gap-1.5',
          '[&>div[data-kind=boolean]]:grid [&>div[data-kind=boolean]]:grid-cols-[auto_1fr] [&>div[data-kind=boolean]]:items-center [&>div[data-kind=boolean]]:gap-x-2 [&>div[data-kind=boolean]]:gap-y-1',
          '[&>div[data-kind=boolean]>label]:col-start-2 [&>div[data-kind=boolean]>label]:row-start-1',
          '[&>div[data-kind=boolean]>[data-slot=checkbox]]:col-start-1 [&>div[data-kind=boolean]>[data-slot=checkbox]]:row-start-1',
          '[&>div[data-kind=boolean]>:not(label):not([data-slot=checkbox])]:col-start-2',
          '[&_fieldset]:flex [&_fieldset]:flex-col [&_fieldset]:gap-4',
          '[&_fieldset>div]:flex [&_fieldset>div]:flex-col [&_fieldset>div]:gap-1.5',
          '[&_legend]:text-sm [&_legend]:font-medium',
          className,
        )}
        {...props}
      />
    </>
  );
}

/** The block's `resolveData` state, shown above its form. */
function NodeStatusNote({ blockId }: { blockId: string }) {
  const { loading, error } = useNodeStatus(blockId);
  if (error) {
    return (
      <p
        role="alert"
        data-slot="editor-node-error"
        className="text-destructive text-sm"
      >
        {error.message}
      </p>
    );
  }
  if (loading) {
    return (
      <p
        aria-live="polite"
        data-slot="editor-node-loading"
        className="text-muted-foreground text-sm"
      >
        Loading...
      </p>
    );
  }
  return null;
}

/** The label of a block: the palette label, `Page` for the root. */
function useBlockLabel(blockId: string): string {
  const { schema } = useEditorContext('FormSurface');
  return useDocSelector((doc) => {
    const node = doc.nodes[blockId];
    if (!node || blockId === doc.rootId) return 'Page';
    return describeBlock(schema, node).label;
  });
}

/** Where the form is: the page, then each ancestor down to the block. */
function FormBreadcrumb({ blockId }: { blockId: string }) {
  const store = useEditorStore();
  const path = useDocSelector((doc) => {
    const ids: string[] = [];
    for (let id: string | undefined = blockId; id;) {
      ids.unshift(id);
      id = doc.nodes[id]?.parent?.id;
    }
    return ids;
  });
  if (path.length < 2) return null;
  return (
    <nav
      aria-label="Block path"
      data-slot="editor-form-breadcrumb"
      className="text-muted-foreground mb-2 flex flex-wrap items-center gap-1 text-xs"
    >
      {path.slice(0, -1).map((id, index) => (
        <span key={id} className="flex items-center gap-1">
          {index > 0 ? <ChevronRightIcon className="size-3" /> : null}
          <button
            type="button"
            className="hover:text-foreground rounded-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
            onClick={() => store.select(index === 0 ? null : id)}
          >
            <BlockLabel blockId={id} />
          </button>
        </span>
      ))}
      <ChevronRightIcon className="size-3" />
    </nav>
  );
}

function BlockLabel({ blockId }: { blockId: string }) {
  return <>{useBlockLabel(blockId)}</>;
}

/** One child block as a row that opens its form. */
function ChildRow({ blockId }: { blockId: string }) {
  const store = useEditorStore();
  const { schema } = useEditorContext('FormSurface');
  const summary = useDocSelector((doc) => {
    const node = doc.nodes[blockId];
    return node ? describeBlock(schema, node) : null;
  });
  const count = useDocSelector((doc) => {
    const node = doc.nodes[blockId];
    return node
      ? Object.values(node.slots).reduce((sum, ids) => sum + ids.length, 0)
      : 0;
  });
  if (!summary) return null;
  return (
    <li>
      <button
        type="button"
        data-slot="editor-form-child"
        onClick={() => store.select(blockId)}
        className="hover:bg-accent focus-visible:ring-ring flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{summary.label}</span>
          {summary.excerpt ? (
            <span className="text-muted-foreground block truncate text-xs">
              {summary.excerpt}
            </span>
          ) : null}
        </span>
        {count > 0 ? (
          <span className="text-muted-foreground text-xs tabular-nums">
            {count} inside
          </span>
        ) : null}
        <ChevronRightIcon className="text-muted-foreground size-4" />
      </button>
    </li>
  );
}

/** One slot of the block: its children in order. */
function SlotSection({ blockId, slot }: { blockId: string; slot: string }) {
  const children = useSlot(blockId, slot);
  const { schema } = useEditorContext('FormSurface');
  const type = useDocSelector((doc) => doc.nodes[blockId]?.type);
  const spec =
    type === 'root'
      ? schema.root.slots?.[slot]
      : type
        ? schema.components[type]?.slots?.[slot]
        : undefined;
  const label = spec?.label ?? (slot === 'children' ? 'Content' : slot);
  return (
    <section data-slot="editor-form-slot" className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{label}</h2>
      {children.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed px-3 py-3 text-xs">
          Empty. Add blocks from the palette while this block is selected.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {children.map((child) => (
            <ChildRow key={child.id} blockId={child.id} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The form-only edit surface: the selected block's fields (the page when
 * nothing is selected), the path to it, and its nested blocks per slot, so
 * every block is reachable without a canvas.
 */
function FormSurface({
  className,
  children,
  ...props
}: React.ComponentProps<'div'>) {
  const rootId = useEditor((state) => state.rootId);
  const selected = useSelection().selected;
  const blockId = selected ?? rootId;
  const label = useBlockLabel(blockId);
  const slots = useSlots(blockId);
  const hasFields = useFields(blockId).length > 0;

  return (
    <div
      data-slot="editor-form-surface"
      className={cn(
        'mx-auto min-h-0 w-full max-w-xl flex-1 overflow-y-auto px-6 py-8',
        className,
      )}
      {...props}
    >
      <FormBreadcrumb blockId={blockId} />
      <h1 className="mb-6 text-lg font-semibold tracking-tight">{label}</h1>
      {hasFields ? <Form blockId={blockId} /> : null}
      {slots.length > 0 ? (
        <div
          className={cn(
            'flex flex-col gap-6',
            hasFields && 'mt-8 border-t pt-6',
          )}
        >
          {slots.map((slot) => (
            <SlotSection key={slot} blockId={blockId} slot={slot} />
          ))}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export { Form, FormSurface };

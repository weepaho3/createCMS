import * as React from 'react';

import type { EditorDocument, NodeData } from '../core/document';
import type { EditProps } from '../core/edit';
import type { AnyEditorSchema } from '../core/schema';

import { NO_EDIT } from '../core/edit';
import { DEFAULT_SLOT, slotsOf } from '../core/schema';

/** What a production component receives: the canvas props without editing. */
export type RenderBlockProps = {
  id: string;
  type: string;
  props: Readonly<Record<string, unknown>>;
  /** The rendered `children` slot. */
  children: React.ReactNode;
  /** Every slot of the node rendered, keyed by slot name. */
  slots: Readonly<Record<string, React.ReactNode>>;
  /** Inactive anchors, so canvas components render unchanged. */
  edit: EditProps;
};

export type RenderComponent = (props: RenderBlockProps) => React.ReactNode;

/** Component type to component; the root renders its children only. */
export type RenderComponents = Readonly<Record<string, RenderComponent>>;

export type RenderDocumentOptions = {
  /** Orders each node's slots by the schema (declared slots first). */
  schema?: AnyEditorSchema;
  /**
   * Wraps every block element, e.g. in a client error boundary
   * (`BlockErrorBoundary` from `@createcms/react/editor/canvas`).
   */
  wrapBlock?: (
    element: React.ReactElement,
    block: { id: string; type: string },
  ) => React.ReactNode;
  /** Renders a block type without a component (default: nothing). */
  unknown?: (block: {
    id: string;
    type: string;
    props: Readonly<Record<string, unknown>>;
  }) => React.ReactNode;
};

function renderNode(
  node: NodeData,
  components: RenderComponents,
  options: RenderDocumentOptions,
): React.ReactNode {
  const names = Object.keys(node.slots ?? {});
  const declared = options.schema
    ? Object.keys(slotsOf(options.schema, node.type)).filter((name) =>
        names.includes(name),
      )
    : [];
  const ordered = [...declared, ...names.filter((n) => !declared.includes(n))];
  const slots: Record<string, React.ReactNode> = {};
  for (const name of ordered) {
    const children = node.slots?.[name] ?? [];
    slots[name] =
      children.length === 0
        ? null
        : children.map((child) =>
            React.createElement(
              React.Fragment,
              { key: child.id },
              renderNode(child, components, options),
            ),
          );
  }
  const children = slots[DEFAULT_SLOT] ?? null;
  if (node.type === 'root') return children;
  const Component = components[node.type];
  if (!Component) {
    return options.unknown
      ? options.unknown({ id: node.id, type: node.type, props: node.props })
      : null;
  }
  const element = React.createElement(Component, {
    id: node.id,
    type: node.type,
    props: node.props,
    slots,
    edit: NO_EDIT,
    children,
  });
  return options.wrapBlock
    ? options.wrapBlock(element, { id: node.id, type: node.type })
    : element;
}

/**
 * Renders a stored document with production components. A pure function
 * without hooks or client-only imports, so React Server Components can call
 * it; wrap blocks in a client error boundary through `wrapBlock`.
 */
export function renderDocument(
  doc: EditorDocument,
  components: RenderComponents,
  options: RenderDocumentOptions = {},
): React.ReactNode {
  return renderNode(doc.root, components, options);
}

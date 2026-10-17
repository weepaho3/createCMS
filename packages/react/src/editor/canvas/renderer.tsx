import * as React from 'react';

import type { NodeData } from '../core/document';
import type { AnyEditorSchema } from '../core/schema';
import type { EditorNodes } from '../core/store';
import type { EditCache } from './edit';
import type { CanvasComponent } from './map';
import type { CanvasResolve, ResolveCache } from './resolve';

import { DEFAULT_SLOT, fieldsOf } from '../core/schema';
import { serializeToTree } from '../core/store';
import { withEmptyFieldPlaceholder } from './inline-text';
import { resolveNodeProperties } from './resolve';

export type RenderStoreTreeArgs = {
  nodes: EditorNodes;
  rootId: string;
  schema: AnyEditorSchema;
  components: Readonly<Record<string, CanvasComponent>>;
  resolve: CanvasResolve | undefined;
  cache: ResolveCache;
  edits: EditCache;
};

export function renderStoreTree(args: RenderStoreTreeArgs): React.ReactNode {
  return renderNode(serializeToTree(args.nodes, args.rootId), args);
}

function renderNode(
  node: NodeData,
  args: RenderStoreTreeArgs,
): React.ReactNode {
  const childElements = (node.slots?.[DEFAULT_SLOT] ?? []).map((child) => (
    <React.Fragment key={child.id}>{renderNode(child, args)}</React.Fragment>
  ));

  if (node.type === 'root') return <>{childElements}</>;

  const Component = args.components[node.type];
  if (!Component) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        `Canvas.Root: no component mapped for block type "${node.type}"`,
      );
    }
    return null;
  }

  const { properties, unresolved } = resolveNodeProperties(
    node.type,
    node.props,
    args.schema,
    args.resolve,
    args.cache,
  );

  return (
    <Component
      key={node.id}
      id={node.id}
      type={node.type}
      props={withEmptyFieldPlaceholder(
        properties,
        fieldsOf(args.schema, node.type),
      )}
      node={node}
      edit={args.edits.get(node.id, node.type, args.schema, unresolved)}
    >
      {childElements.length > 0 ? childElements : null}
    </Component>
  );
}

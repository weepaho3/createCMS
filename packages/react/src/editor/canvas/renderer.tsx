import type { BlockTreeNode } from '@createcms/schema';

import * as React from 'react';

import type { AnyEditorSchema } from '../schema';
import type { EditorNodes } from '../store';
import type { EditCache } from './edit';
import type { CanvasComponent } from './map';
import type { CanvasResolve, ResolveCache } from './resolve';

import { propertiesOf } from '../schema';
import { serializeToTree } from '../store';
import { NO_EDIT } from './edit';
import { withEmptyFieldPlaceholder } from './inline-text';
import { isResolvedReference, resolveNodeProperties } from './resolve';

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
  const tree = serializeToTree(args.nodes, args.rootId);
  return renderNode(tree, args, false);
}

function renderNode(
  node: BlockTreeNode,
  args: RenderStoreTreeArgs,
  fromReference: boolean,
): React.ReactNode {
  const childElements = node.children.map((child) => (
    <React.Fragment key={child.blockId}>
      {renderNode(child, args, fromReference)}
    </React.Fragment>
  ));

  if (node.type === 'root') {
    return <>{childElements}</>;
  }

  const { properties, unresolved } = resolveNodeProperties(
    node.type,
    node.properties,
    args.schema,
    args.resolve,
    args.cache,
  );

  const refChildren: React.ReactNode[] = [];
  for (const value of Object.values(properties)) {
    if (isResolvedReference(value) && value.tree.children.length > 0) {
      for (const child of value.tree.children) {
        refChildren.push(
          <React.Fragment key={child.blockId}>
            {renderNode(child, args, true)}
          </React.Fragment>,
        );
      }
    }
  }

  const refGroup =
    refChildren.length > 0 ? (
      <div data-editor-readonly="" inert={true} style={{ display: 'contents' }}>
        {refChildren}
      </div>
    ) : null;

  const Component = args.components[node.type];

  if (!Component) {
    if (refGroup) return <>{refGroup}</>;
    if (!fromReference && process.env.NODE_ENV !== 'production') {
      console.warn(
        `Canvas.Root: no component mapped for block type "${node.type}"`,
      );
    }
    return null;
  }

  const allChildren =
    childElements.length > 0 || refGroup ? (
      <>
        {childElements}
        {refGroup}
      </>
    ) : null;

  const edit = fromReference
    ? NO_EDIT
    : args.edits.get(node.blockId, node.type, args.schema, unresolved);

  const display = fromReference
    ? properties
    : withEmptyFieldPlaceholder(
        properties,
        propertiesOf(args.schema, node.type),
      );

  return (
    <Component
      key={node.blockId}
      properties={display}
      blockId={node.blockId}
      node={node}
      edit={edit}
    >
      {allChildren}
    </Component>
  );
}

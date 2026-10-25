import type {
  AnyCollectionDefinition,
  BlockProperty,
  BlockTreeNode,
  ResolvedReference,
} from '@createcms/schema';

import * as React from 'react';

import type {
  CanvasComponent,
  CanvasComponentProps,
  CanvasComponents,
} from '../canvas';
import type { EditProps } from '../core';

import { Canvas } from '../canvas';
import { NO_EDIT } from '../core';
import { editorValueToCms } from './mapping';

/** A createcms block component: what `createBlocksMap` holds per block type. */
type CmsBlockComponent = (props: {
  properties: Record<string, unknown>;
  children: React.ReactNode;
  blockId: string;
  node: BlockTreeNode;
  edit: EditProps;
}) => React.ReactNode;

/** The structural shape of a `createBlocksMap` result. */
export type CmsBlocksMap<
  C extends AnyCollectionDefinition = AnyCollectionDefinition,
> = {
  readonly _components: Readonly<Record<string, unknown>>;
  readonly _collection: C;
};

/** The published reference shape; this package does not import core. */
export function isResolvedReference(
  value: unknown,
): value is ResolvedReference {
  return (
    typeof value === 'object' &&
    value !== null &&
    'rootId' in value &&
    'collection' in value &&
    'tree' in value &&
    'properties' in value
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Canvas props in the shape a createcms component reads on the published
 * page: media as asset ids, references as the resolved document (left out
 * while unresolved, like a published read without the target), links and
 * text as resolved or stored.
 */
function cmsProperties(
  props: Record<string, unknown>,
  specs: Record<string, BlockProperty>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    const spec = specs[key];
    if (spec?.type === 'reference' && !isResolvedReference(value)) {
      if (isRecord(value) && 'id' in value) continue;
    }
    out[key] =
      spec && !isResolvedReference(value)
        ? editorValueToCms(spec, value)
        : value;
  }
  return out;
}

function renderReadonlyTree(
  node: BlockTreeNode,
  components: Readonly<Record<string, CmsBlockComponent>>,
): React.ReactNode {
  const children = node.children.map((child) => (
    <React.Fragment key={child.blockId}>
      {renderReadonlyTree(child, components)}
    </React.Fragment>
  ));
  if (node.type === 'root') return <>{children}</>;
  const Component = components[node.type];
  if (!Component) return null;
  return (
    <Component
      properties={node.properties}
      blockId={node.blockId}
      node={node}
      edit={NO_EDIT}
    >
      {children.length > 0 ? children : null}
    </Component>
  );
}

/**
 * Canvas components for a `createBlocksMap` result: each wraps the createcms
 * block component, hands it `properties`/`blockId`/`node` in createcms shape
 * (in the canvas `node.children` is empty: children arrive as React
 * children, rendered per node)
 * and appends the blocks of resolved references after its children, inside
 * `Canvas.ReadonlySubtree` (shown, never edited or selected).
 */
export function cmsCanvasComponents(map: CmsBlocksMap): CanvasComponents {
  const blockComponents = map._components as Readonly<
    Record<string, CmsBlockComponent>
  >;
  const def = map._collection;
  const out: Record<string, CanvasComponent> = {};
  for (const [type, Block] of Object.entries(blockComponents)) {
    const specs = def.blocks?.[type]?.properties ?? {};
    const Wrapped = (props: CanvasComponentProps) => {
      const properties = cmsProperties(props.props, specs);
      const references = Object.values(properties).filter(isResolvedReference);
      const embedded =
        references.length > 0 ? (
          <Canvas.ReadonlySubtree>
            {references.map((ref) => (
              <React.Fragment key={ref.rootId}>
                {renderReadonlyTree(ref.tree, blockComponents)}
              </React.Fragment>
            ))}
          </Canvas.ReadonlySubtree>
        ) : null;
      return (
        <Block
          properties={properties}
          blockId={props.id}
          node={{ blockId: props.id, type, properties, children: [] }}
          edit={props.edit}
        >
          {props.children === null && embedded === null ? null : (
            <>
              {props.children}
              {embedded}
            </>
          )}
        </Block>
      );
    };
    Wrapped.displayName = `CmsBlock(${type})`;
    out[type] = Wrapped;
  }
  return out;
}

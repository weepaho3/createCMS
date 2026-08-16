import type { BlockTreeNode, EditProps } from '@createcms/schema';
import type * as React from 'react';

export type CanvasComponent = (props: {
  properties: Record<string, unknown>;
  children: React.ReactNode;
  blockId: string;
  node: BlockTreeNode;
  edit: EditProps;
}) => React.ReactNode;

export type CanvasComponents =
  | Readonly<Record<string, CanvasComponent>>
  | { readonly _components: Readonly<Record<string, CanvasComponent>> };

export function resolveComponentMap(
  components: CanvasComponents,
): Readonly<Record<string, CanvasComponent>> {
  if (
    typeof components === 'object' &&
    components !== null &&
    '_components' in components &&
    (components as { _components?: unknown })._components &&
    typeof (components as { _components: unknown })._components === 'object'
  ) {
    return (components as { _components: Record<string, CanvasComponent> })
      ._components;
  }
  return components as Record<string, CanvasComponent>;
}

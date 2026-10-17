import type * as React from 'react';

import type { EditProps } from '../core/edit';

/** What `Canvas.Root` hands each component of its map. */
export type CanvasComponentProps = {
  /** The node's id. */
  id: string;
  type: string;
  /** Resolved props (see `Canvas.Root`'s `resolve`), placeholders for empty inline fields. */
  props: Record<string, unknown>;
  /** The rendered `children` slot. */
  children: React.ReactNode;
  /** Every slot of the node rendered, keyed by slot name (`children` included). */
  slots: Readonly<Record<string, React.ReactNode>>;
  edit: EditProps;
};

export type CanvasComponent = (props: CanvasComponentProps) => React.ReactNode;

/** Component type → component. The root renders its children only. */
export type CanvasComponents = Readonly<Record<string, CanvasComponent>>;

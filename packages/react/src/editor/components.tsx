import type { AnyCollectionDefinition } from '@createcms/schema';

import * as React from 'react';

import { EditorContext } from './context';

export type EditorRootProps = {
  /** The collection definition (the editor's schema). */
  schema: AnyCollectionDefinition;
  children?: React.ReactNode;
};

/**
 * Provider-only root: renders no DOM element and exposes the schema to every
 * part below it. `schema` is required — a tree alone cannot tell which
 * collection it belongs to.
 */
export function EditorRoot({ schema, children }: EditorRootProps) {
  const value = React.useMemo(() => ({ schema }), [schema]);
  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  );
}

import type { AnyCollectionDefinition } from '@createcms/schema';

import * as React from 'react';

import { EditorContext } from './context';

export type EditorRootProps = {
  /** The collection definition (the editor's schema). */
  schema: AnyCollectionDefinition;
  children?: React.ReactNode;
};

/**
 * Provider-only root for now: renders no DOM element and exposes the schema
 * to every part below it. State, callbacks and the typed factory come with
 * the next issues; the prop contract (`schema` is required) is final.
 */
export function EditorRoot({ schema, children }: EditorRootProps) {
  const value = React.useMemo(() => ({ schema }), [schema]);
  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  );
}

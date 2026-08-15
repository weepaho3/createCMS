'use client';

// @createcms/react/editor — schema, state, form and preview layer of the
// editor primitive. Namespace export like @shadcn/react: `Editor.Root`, …
// Behavior parts arrive issue by issue; this file is the stable public entry.
import { EditorRoot } from './components';

export type { EditorRootProps } from './components';
export type { EditorContextValue } from './types';
export { useEditorContext } from './context';

export const Editor = {
  Root: EditorRoot,
};

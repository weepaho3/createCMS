import type { AnyCollectionDefinition } from '@createcms/schema';

/**
 * What `Editor.Root` shares with every part below it. One context object for
 * the whole package: created once and shared by every entry.
 */
export type EditorContextValue = {
  readonly schema: AnyCollectionDefinition;
};

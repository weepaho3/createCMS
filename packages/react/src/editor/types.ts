import type { AnyCollectionDefinition } from '@createcms/schema';

/**
 * What `Editor.Root` shares with every part below it. Deliberately minimal
 * for the package skeleton: the store, selection and actions arrive with the
 * state layer. Only the schema is here today because every later part needs
 * it and it fixes the one architectural rule the skeleton must prove — this
 * context is created once and shared by every entry of the package.
 */
export type EditorContextValue = {
  readonly schema: AnyCollectionDefinition;
};

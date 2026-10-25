/**
 * Compile-time guarantee that the editor's `EditProps` and the copy in
 * `@createcms/schema` stay structurally equal, so createcms block components
 * accept the canvas anchors and editor components accept `NO_EDIT` from core.
 */
import type {
  EditAttrs as SchemaEditAttrs,
  EditProps as SchemaEditProps,
} from '@createcms/schema';

import type { EditAttrs, EditProps } from '../core';

type MutuallyAssignable<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
type Expect<T extends true> = T;

export type _editAttrs = Expect<MutuallyAssignable<EditAttrs, SchemaEditAttrs>>;
export type _editProps = Expect<MutuallyAssignable<EditProps, SchemaEditProps>>;

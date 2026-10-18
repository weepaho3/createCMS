/**
 * `@createcms/schema`'s `RichTextDoc` and the editor core's are declared
 * separately (neither package depends on the other); a stored value must
 * pass between them unchanged. Not shipped; covered by `tsc --noEmit`.
 */
import type { RichTextDoc as SchemaRichTextDoc } from '@createcms/schema';

import type { RichTextDoc } from '../core';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

export type _sameDoc = Expect<Equal<SchemaRichTextDoc, RichTextDoc>>;

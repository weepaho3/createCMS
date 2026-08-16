/**
 * Compile-time guarantees for the structure parts. Ships nothing (no entry
 * imports it) but is covered by `tsc --noEmit`; a failing `Expect` or an
 * unused `@ts-expect-error` fails the type-check gate.
 */
import type { EditorFactory, TypedBlockActions } from '../factory';
import { storeSchema } from '../store/fixtures';
import type { EditorAddBlockProps, EditorOutlineItemProps } from './types';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

export type _onDeleteReturn = Expect<
  Equal<
    ReturnType<NonNullable<EditorOutlineItemProps['onDelete']>>,
    boolean | void
  >
>;

const addBlock: EditorAddBlockProps = { type: 'heading' };
void addBlock;
// @ts-expect-error - type is required
const missingType: EditorAddBlockProps = {};
void missingType;

declare const factory: EditorFactory<typeof storeSchema>;
void storeSchema;
export type _childType = Expect<
  Equal<
    ReturnType<typeof factory.useChildren>[number]['type'],
    'heading' | 'paragraph' | 'image' | 'section'
  >
>;

declare const actions: TypedBlockActions<typeof storeSchema>;
actions.add('heading');
// @ts-expect-error - unknown block type
actions.add('nope');

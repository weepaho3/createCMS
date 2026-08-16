/**
 * Type-level guarantees for the block component props and the `edit` prop.
 * Type-checked by `tsc --noEmit`, never built (no entry imports it).
 */
import type { CollectionDefinition } from '../core/types/definitions';
import type {
  BlockComponentMap,
  BlockComponentProps,
  BlockProps,
  EditAttrs,
  EditProps,
} from './blocks';

import { NO_EDIT, createBlocksMap } from './blocks';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

const pages = {
  label: 'Pages',
  root: { properties: {} },
  blocks: {
    hero: {
      label: 'Hero',
      properties: {
        headline: { type: 'string', label: 'Headline', required: true },
        badge: { type: 'string', label: 'Badge' },
      },
    },
    // Every property optional: the value type is `… | undefined`, the edit
    // keys still exist because they come from the definition.
    note: {
      label: 'Note',
      properties: { text: { type: 'string', label: 'Text' } },
    },
  },
} satisfies CollectionDefinition;
type Pages = typeof pages;

// --- edit.field is keyed by the DEFINITION's property keys -----------------
type HeroEdit = BlockProps<Pages, 'hero'>['edit'];
export type _heroField = Expect<
  Equal<HeroEdit['field']['headline'], EditAttrs | undefined>
>;
declare const heroEdit: HeroEdit;
void heroEdit.field.badge;
// @ts-expect-error - not a property of the hero block
void heroEdit.field.nope;

type NoteEdit = BlockProps<Pages, 'note'>['edit'];
export type _noteFieldExists = Expect<
  Equal<NoteEdit['field']['text'], EditAttrs | undefined>
>;

// --- properties are non-nullable in component props -------------------------
type NoteProps = BlockProps<Pages, 'note'>['properties'];
export type _notePropsObject = Expect<Equal<NoteProps, { text?: string }>>;

// --- NO_EDIT fits every block's edit prop ------------------------------------
const heroFromConst: HeroEdit = NO_EDIT;
void heroFromConst;
const noteFromConst: NoteEdit = NO_EDIT;
void noteFromConst;

// --- components may ignore `edit`; a manual render must pass it -------------
declare function Hero(props: BlockProps<Pages, 'hero'>): null;
void createBlocksMap(pages, {
  hero: ({ properties }) => properties.headline,
  note: ({ properties, edit }) => (edit.active ? properties.text : null),
});
declare const heroProps: Omit<BlockProps<Pages, 'hero'>, 'edit'>;
void Hero({ ...heroProps, edit: NO_EDIT });
// @ts-expect-error - `edit` is required
void Hero(heroProps);

// --- generic shapes -----------------------------------------------------------
export type _mapNeedsEdit = Expect<
  Parameters<BlockComponentMap<Pages['blocks']>['hero']>[0] extends {
    edit: EditProps<Pages['blocks']['hero']['properties']>;
  }
    ? true
    : false
>;
export type _defaultProps = Expect<
  BlockComponentProps extends { edit: EditProps } ? true : false
>;

/**
 * Compile-time guarantees for the field parts. Ships nothing (no entry
 * imports it) but is covered by `tsc --noEmit`; a failing `Expect` or an
 * unused `@ts-expect-error` fails the type-check gate.
 */
import type { EditorRootProps } from '../components';
import type {
  Field,
  FieldKind,
  MediaValue,
  SelectOption,
} from '../core/schema';
import type { EditorContextValue } from '../types';
import type {
  FieldControlProps,
  FieldControls,
  ListElementRender,
  NestedFieldRender,
} from './types';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// --- per-kind control props -------------------------------------------------

// A `select` control sees the options, a single or multiple value, and may clear.
const selectControl: FieldControls['select'] = (p) => {
  const options: readonly SelectOption[] = p.spec.options;
  const value: string | string[] | undefined = p.value;
  const multiple: boolean | undefined = p.spec.multiple;
  void options;
  void value;
  void multiple;
  p.onChange('x');
  p.onChange(['x', 'y']);
  p.onChange(undefined);
  return null;
};
void selectControl;

// A `text` control is typed against the text kind only.
const textControl: FieldControls['text'] = (p) => {
  const maxLength: number | undefined = p.spec.maxLength;
  const readOnly: boolean = p.readOnly;
  void maxLength;
  void readOnly;
  // @ts-expect-error - a text control cannot write a number
  p.onChange(3);
  // @ts-expect-error - a text field has no options
  void p.spec.options;
  return null;
};
void textControl;

// A `list` control sees the element array, the element field and the element renderer.
const listControl: FieldControls['list'] = (p) => {
  const value: unknown[] | undefined = p.value;
  const elementType: FieldKind = p.spec.of.type;
  const renderElement: ListElementRender | undefined = p.renderElement;
  void value;
  void elementType;
  void renderElement;
  return null;
};
void listControl;

// An `object` control sees its nested fields and the nested renderer.
const objectControl: FieldControls['object'] = (p) => {
  const fields: Record<string, Field> = p.spec.fields;
  const value: Record<string, unknown> | undefined = p.value;
  const renderNested: NestedFieldRender | undefined = p.renderNested;
  void fields;
  void value;
  void renderNested;
  return null;
};
void objectControl;

export type _listValue = Expect<
  Equal<FieldControlProps<'list'>['value'], unknown[] | undefined>
>;
export type _numberValue = Expect<
  Equal<FieldControlProps<'number'>['value'], number | undefined>
>;
export type _mediaValue = Expect<
  Equal<FieldControlProps<'media'>['value'], MediaValue | undefined>
>;

// A component declared for one kind cannot serve another.
const wrongKind: FieldControls = {
  // @ts-expect-error - a number control cannot serve the text kind
  text: (p: FieldControlProps<'number'>) => {
    void p;
    return null;
  },
};
void wrongKind;

// Custom controls are registered per custom kind name.
const customControls: FieldControls = {
  custom: {
    'icon-picker': (p) => {
      const kind: string = p.spec.kind;
      void kind;
      return null;
    },
  },
};
void customControls;

// --- Root and context -------------------------------------------------------

export type _contextFields = Expect<
  Equal<EditorContextValue['fields'], FieldControls>
>;
export type _rootFieldsOptional = Expect<
  Equal<EditorRootProps['fields'], FieldControls | undefined>
>;
const rootWithoutFields: Pick<EditorRootProps, 'fields'> = {};
void rootWithoutFields;

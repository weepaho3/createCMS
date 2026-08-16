/**
 * Compile-time guarantees for the field parts. Ships nothing (no entry
 * imports it) but is covered by `tsc --noEmit`; a failing `Expect` or an
 * unused `@ts-expect-error` fails the type-check gate.
 */
import type { ListElementType, SelectOption } from '@createcms/schema';

import type { EditorRootProps } from '../components';
import type { EditorContextValue } from '../types';
import type {
  FieldControlProps,
  FieldControls,
  ListElementRender,
} from './types';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

// --- per-kind control props -------------------------------------------------

// A `select` control sees the options and a string value, and may clear.
const selectControl: FieldControls['select'] = (p) => {
  const options: readonly SelectOption[] = p.spec.options;
  const value: string | undefined = p.value;
  void options;
  void value;
  p.onChange('x');
  p.onChange(undefined);
  return null;
};
void selectControl;

// A `string` control is typed against the string kind only.
const stringControl: FieldControls['string'] = (p) => {
  const maxLength: number | undefined = p.spec.maxLength;
  void maxLength;
  // @ts-expect-error - a string control cannot write a number
  p.onChange(3);
  // @ts-expect-error - a string spec has no options
  void p.spec.options;
  return null;
};
void stringControl;

// A `list` control sees the wide element array, the element spec and the optional element renderer.
const listControl: FieldControls['list'] = (p) => {
  const value: Array<string | number | boolean> | undefined = p.value;
  const elementType: ListElementType = p.spec.of.type;
  const renderElement: ListElementRender | undefined = p.renderElement;
  void value;
  void elementType;
  void renderElement;
  return null;
};
void listControl;

export type _listValue = Expect<
  Equal<
    FieldControlProps<'list'>['value'],
    Array<string | number | boolean> | undefined
  >
>;
export type _listRenderElementOptional = Expect<
  Equal<FieldControlProps<'list'>['renderElement'], ListElementRender | undefined>
>;
export type _numberValue = Expect<
  Equal<FieldControlProps<'number'>['value'], number | undefined>
>;

// A component declared for one kind cannot serve another.
const wrongKind: FieldControls = {
  // @ts-expect-error - a number control cannot serve the string kind
  string: (p: FieldControlProps<'number'>) => {
    void p;
    return null;
  },
};
void wrongKind;

// --- Root and context -------------------------------------------------------

export type _contextFields = Expect<
  Equal<EditorContextValue['fields'], FieldControls>
>;
export type _rootFieldsOptional = Expect<
  Equal<EditorRootProps['fields'], FieldControls | undefined>
>;
const rootWithoutFields: Pick<EditorRootProps, 'fields'> = {};
void rootWithoutFields;

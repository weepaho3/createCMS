import type { JsonValue } from '../document';
import type { Field } from './types';

import { EMPTY_RICH_TEXT } from '../richtext/schema';

export type DefaultValuesOptions = {
  /**
   * Also fill kinds WITHOUT a declared `defaultValue` with a neutral value:
   * `boolean` → `false`, `number` → `0`, `select` → its first option's value
   * (`[]` with `multiple`), `text`/`textarea` → `''`, `richText` → one empty paragraph, `list` →
   * `[]`, `object` → its nested neutral values. `date`, `color`, `media`,
   * `reference`, `link` and `custom` stay absent: an empty string is not a
   * valid value for them, so "no key" is the only honest default.
   */
  fillDefaults?: boolean;
};

/**
 * Initial props for a new node of the given component: every field with a
 * declared `defaultValue` (other than `undefined`) contributes
 * `key → defaultValue`; `null`, `false`, `0` and `''` count as declared.
 * Nothing else, unless `fillDefaults` is on.
 */
export function defaultValuesFor(
  def: { readonly fields: Record<string, Field> },
  options: DefaultValuesOptions = {},
): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [key, field] of Object.entries(def.fields)) {
    const value = defaultValueOf(field, options);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function defaultValueOf(
  field: Field,
  options: DefaultValuesOptions,
): JsonValue | undefined {
  if ('defaultValue' in field && field.defaultValue !== undefined) {
    return field.defaultValue as JsonValue;
  }
  if (!options.fillDefaults) return undefined;
  switch (field.type) {
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'select':
      if (field.multiple) return [];
      return field.options[0]?.value;
    case 'text':
    case 'textarea':
      return '';
    case 'richText':
      return structuredClone(EMPTY_RICH_TEXT);
    case 'list':
      return [];
    case 'object':
      return defaultValuesFor(field, options);
    case 'date':
    case 'color':
    case 'media':
    case 'reference':
    case 'link':
    case 'custom':
      return undefined;
  }
}

import type { BlockProperty } from '@createcms/schema';

export type DefaultValuesOptions = {
  /**
   * Also fill kinds WITHOUT a declared `defaultValue` with a neutral value:
   * `boolean` → `false`, `number` → `0`, `select` → its first option's value
   * (only when it has options), `string`/`richText` → `''`, `list` → `[]`.
   * `date`, `image`, `reference` and `link` stay ABSENT: an empty string is
   * not a valid value for them (an ISO datetime, an asset/root id, a
   * `LinkValue`), so "no key" is the only honest default and the controls
   * treat `undefined` as empty. Off by default: core's `createBlock` seeds
   * only declared `defaultValue`s, and the editor should build the same
   * properties object the server would.
   */
  fillDefaults?: boolean;
};

/**
 * Initial `properties` for a new block (or root) of the given definition.
 * Same rule as core's `defaultPropertiesFor`: every property with a declared
 * `defaultValue` (other than `undefined`) contributes `key → defaultValue`;
 * `null`, `false`, `0` and `''` count as declared. Nothing else, unless
 * `fillDefaults` is on.
 */
export function defaultValuesFor(
  def: { readonly properties: Record<string, BlockProperty> },
  options: DefaultValuesOptions = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(def.properties)) {
    if ('defaultValue' in spec && spec.defaultValue !== undefined) {
      out[key] = spec.defaultValue;
      continue;
    }
    if (!options.fillDefaults) continue;
    switch (spec.type) {
      case 'boolean':
        out[key] = false;
        break;
      case 'number':
        out[key] = 0;
        break;
      case 'select': {
        const first = spec.options[0];
        if (first) out[key] = first.value;
        break;
      }
      case 'string':
      case 'richText':
        out[key] = '';
        break;
      case 'list':
        out[key] = [];
        break;
      case 'date':
      case 'image':
      case 'reference':
      case 'link':
        // No valid neutral value, the key stays absent.
        break;
    }
  }
  return out;
}

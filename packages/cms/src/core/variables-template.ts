/**
 * `{{key}}` template handling with no runtime dependency: safe to import in a
 * browser bundle (through `@createcms/core/react`) and on the server (through
 * `@createcms/core`).
 *
 * `VAR_PATTERN` is a shared GLOBAL regex: reset `lastIndex` before a manual
 * `exec`/`test`, or prefer `extractVariableKeys` / `String.prototype.matchAll`.
 */
export const VAR_PATTERN = /\{\{(\w+)\}\}/g;

/**
 * Extracts all variable keys referenced in a string value.
 * Returns a deduplicated array of keys, in first-appearance order.
 */
export function extractVariableKeys(value: string): string[] {
  const keys = new Set<string>();
  let match: RegExpExecArray | null;
  VAR_PATTERN.lastIndex = 0;
  while ((match = VAR_PATTERN.exec(value)) !== null) {
    keys.add(match[1]);
  }
  return [...keys];
}

/**
 * Scans all string properties of a block and returns a map of
 * propertyKey -> variableKeys[] for properties that contain {{...}} patterns.
 */
export function extractVariableKeysFromProperties(
  properties: Record<string, unknown>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [propKey, value] of Object.entries(properties)) {
    if (typeof value !== 'string') continue;
    const keys = extractVariableKeys(value);
    if (keys.length > 0) {
      result.set(propKey, keys);
    }
  }
  return result;
}

/**
 * Replaces every `{{key}}` in `template` with `vars.get(key)`; an unknown key
 * is left literal. Pure: the same call the server makes when it substitutes
 * variables on read, usable in the browser with an already loaded map.
 */
export function resolveTemplateString(
  template: string,
  vars: Map<string, string>,
): string {
  VAR_PATTERN.lastIndex = 0;
  return template.replace(
    VAR_PATTERN,
    (_, varKey) => vars.get(varKey) ?? `{{${varKey}}}`,
  );
}

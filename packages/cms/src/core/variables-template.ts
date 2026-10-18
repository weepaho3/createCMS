/**
 * `{{key}}` template handling with no runtime dependency: safe to import in a
 * browser bundle (through `@createcms/core/react`) and on the server (through
 * `@createcms/core`).
 *
 * `VAR_PATTERN` is a shared GLOBAL regex: reset `lastIndex` before a manual
 * `exec`/`test`, or prefer `extractVariableKeys` / `String.prototype.matchAll`.
 */
import type { RichTextDoc } from './rich-text/types';

import { walkText } from './rich-text/convert';
import { isRichTextDoc } from './rich-text/schema';

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
 * The variable keys in the text nodes of a rich text value, deduplicated in
 * first-appearance order. A `{{key}}` must sit inside one text node: one
 * split by a mark change is not a variable.
 */
export function extractRichTextVariableKeys(doc: RichTextDoc): string[] {
  const keys = new Set<string>();
  walkText(doc, (text) => {
    for (const key of extractVariableKeys(text)) keys.add(key);
  });
  return [...keys];
}

/**
 * Scans the string and `richText` properties of a block (and lists of
 * `richText`) and returns a map of propertyKey -> variableKeys[] for
 * properties that contain {{...}} patterns.
 */
export function extractVariableKeysFromProperties(
  properties: Record<string, unknown>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [propKey, value] of Object.entries(properties)) {
    let keys: string[] = [];
    if (typeof value === 'string') keys = extractVariableKeys(value);
    else if (isRichTextDoc(value)) keys = extractRichTextVariableKeys(value);
    else if (Array.isArray(value) && value.some(isRichTextDoc)) {
      keys = [
        ...new Set(
          value.flatMap((item) =>
            isRichTextDoc(item) ? extractRichTextVariableKeys(item) : [],
          ),
        ),
      ];
    }
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

/**
 * {@link resolveTemplateString} for every text node of a rich text value;
 * returns `doc` itself when nothing was replaced.
 */
export function resolveTemplateRichText(
  doc: RichTextDoc,
  vars: Map<string, string>,
): RichTextDoc {
  return walkText(doc, (text) =>
    text.includes('{{') ? resolveTemplateString(text, vars) : undefined,
  );
}

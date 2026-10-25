/** Where every editor code is explained; each code has an anchor there. */
export const EDITOR_CODES_URL =
  'https://createcms.dev/docs/reference/editor-errors';

/**
 * Every code the editor prints or throws. Warnings are dev-only: call sites
 * guard them with `process.env.NODE_ENV !== 'production'` so production
 * builds drop the text.
 */
export const EDITOR_CODES = {
  E001: {
    level: 'warning',
    summary:
      'A richText field cannot be edited inline without a rich text editor.',
  },
  E002: { level: 'error', summary: 'Two plugins share a name.' },
  E003: {
    level: 'warning',
    summary: 'A shortcut is bound to two commands; the first wins.',
  },
  E004: { level: 'error', summary: 'An unknown UI command was executed.' },
  E005: {
    level: 'warning',
    summary: 'A canvas block rendered no data-editor-block anchor.',
  },
  E006: {
    level: 'warning',
    summary: 'No canvas component is mapped for a block type.',
  },
  E007: {
    level: 'warning',
    summary: 'Editor.Field names a property the block type does not declare.',
  },
  E008: {
    level: 'warning',
    summary: 'No form control is registered for a field kind.',
  },
  E009: { level: 'warning', summary: 'A block threw while rendering.' },
  E010: {
    level: 'warning',
    summary: 'The loaded document needed repairs or migrations.',
  },
  E011: {
    level: 'warning',
    summary: 'html, head or body was rendered inside the live canvas frame.',
  },
  E012: {
    level: 'warning',
    summary: 'An auto-height canvas frame kept growing and was frozen.',
  },
  E013: {
    level: 'warning',
    summary: 'Stylesheets mirrored into the canvas frame did not load in time.',
  },
  E014: {
    level: 'warning',
    summary: 'The live canvas frame is sandboxed.',
  },
  E015: {
    level: 'warning',
    summary: 'richText stored as HTML was converted to JSON on load.',
  },
} as const;

export type EditorCode = keyof typeof EDITOR_CODES;

/** `[editor:E005] message (https://.../editor-errors#e005)`. */
export function formatEditorMessage(code: EditorCode, message: string): string {
  return `[editor:${code}] ${message} (${EDITOR_CODES_URL}#${code.toLowerCase()})`;
}

const warned = new Set<string>();

/**
 * Prints a coded warning once per distinct message. Call it behind
 * `process.env.NODE_ENV !== 'production'` so the text is dropped from
 * production builds.
 */
export function warnOnce(code: EditorCode, message: string): void {
  const text = formatEditorMessage(code, message);
  if (warned.has(text)) return;
  warned.add(text);
  console.warn(text);
}

/** Forgets printed warnings (tests). */
export function resetWarnings(): void {
  warned.clear();
}

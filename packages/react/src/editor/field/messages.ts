import type { FieldError } from '../core/schema';

/**
 * Plain English text for one built-in finding, the default
 * `Editor.FieldError` shows. Map `error.code` and `error.params` yourself for
 * other languages or wording.
 */
export function formatFieldError(error: FieldError): string {
  const params = error.params ?? {};
  const text = (key: string, fallback = ''): string => {
    const value = params[key];
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }
    return value === undefined ? fallback : JSON.stringify(value);
  };
  switch (error.code) {
    case 'required':
      return 'This field is required.';
    case 'type':
      return `Must be ${text('expected', 'a valid value')}.`;
    case 'format':
      return 'Must be an ISO-8601 datetime (UTC).';
    case 'minLength':
      return `Must be at least ${text('min')} characters.`;
    case 'maxLength':
      return `Must be at most ${text('max')} characters.`;
    case 'pattern':
      return 'Has an invalid format.';
    case 'min':
      return `Must be at least ${text('min')}.`;
    case 'max':
      return `Must be at most ${text('max')}.`;
    case 'step':
      return `Must be a multiple of ${text('step')}.`;
    case 'minItems':
      return `Must have at least ${text('min')} item(s).`;
    case 'maxItems':
      return `Must have at most ${text('max')} item(s).`;
    case 'option':
      return 'Must be one of the options.';
    case 'linkKind':
      return 'This link kind is not allowed.';
    case 'linkCollection':
      return 'Links to this collection are not allowed.';
    case 'linkTarget':
      return 'The link needs a target.';
    case 'responsive':
      return 'This field has no per-breakpoint values.';
    case 'localized':
      return 'This field has no per-locale values.';
  }
}

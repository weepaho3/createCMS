import { safeDownloadName } from './content-disposition';

/** Upper bound of a stored file name in UTF-8 bytes. */
export const DISPLAY_NAME_MAX_BYTES = 200;

// C0 and C1 controls, DEL, and the bidi embeddings, overrides and isolates
// (U+202A-U+202E, U+2066-U+2069) that can disguise an extension: with
// U+202E before "fdp.exe", "invoice" + that text displays as "invoiceexe.pdf".
// Built from a string so no invisible character ever sits in this source.
const INVISIBLE = new RegExp(
  // oxlint-disable-next-line no-control-regex -- removing control characters is the point
  '[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]',
  'g',
);

const encoder = new TextEncoder();

/** `text` cut to at most `max` UTF-8 bytes on a code point boundary. */
function truncateUtf8(text: string, max: number): string {
  if (encoder.encode(text).length <= max) return text;
  let out = '';
  let bytes = 0;
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (bytes + size > max) break;
    out += char;
    bytes += size;
  }
  return out;
}

/**
 * The name a file is stored and shown under (`original_name`): Unicode NFC,
 * without control and bidi override characters or path separators,
 * whitespace collapsed, at most `DISPLAY_NAME_MAX_BYTES` UTF-8 bytes with
 * the extension kept. With `mimeType`, the extension is made to match the
 * type (sniffing has confirmed the type by the time a row is written).
 * Object keys never use this name; they stay ASCII slugs.
 */
export function normalizeDisplayName(name: string, mimeType?: string): string {
  let clean = name
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/[/\\]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  if (mimeType) clean = safeDownloadName(clean, mimeType);
  else if (clean === '' || /^\.+$/.test(clean)) clean = 'file';
  const dot = clean.lastIndexOf('.');
  const extension = dot > 0 && clean.length - dot <= 16 ? clean.slice(dot) : '';
  const base = extension ? clean.slice(0, dot) : clean;
  const room = DISPLAY_NAME_MAX_BYTES - encoder.encode(extension).length;
  return `${truncateUtf8(base, room).trimEnd()}${extension}`;
}

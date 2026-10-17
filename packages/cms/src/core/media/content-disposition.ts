/**
 * `Content-Disposition` values per RFC 6266 with an RFC 8187 `filename*`.
 * No DOM or Node APIs.
 */

const EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
  'image/avif': ['avif'],
  'image/svg+xml': ['svg'],
  'video/mp4': ['mp4'],
  'video/webm': ['webm'],
  'audio/mpeg': ['mp3'],
  'application/pdf': ['pdf'],
};

/**
 * `name` without control characters and path separators, ending in an
 * extension that matches `mimeType` (appended when missing or different).
 */
export function safeDownloadName(name: string, mimeType: string): string {
  let withoutControls = '';
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code > 0x1f && code !== 0x7f) withoutControls += name[i];
  }
  let clean = withoutControls.replace(/[/\\]/g, '_').trim();
  if (clean === '' || /^\.+$/.test(clean)) clean = 'download';
  const allowed = EXTENSIONS[mimeType];
  if (!allowed) return clean;
  const dot = clean.lastIndexOf('.');
  const extension = dot > 0 ? clean.slice(dot + 1).toLowerCase() : '';
  return allowed.includes(extension) ? clean : `${clean}.${allowed[0]}`;
}

/** Percent-encodes per RFC 8187 `attr-char`, so `'()*` are encoded too. */
function encodeRfc8187(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * `attachment; filename="<ascii>"; filename*=UTF-8''<encoded>` (or
 * `inline`). `filename` is an ASCII fallback with accents stripped and
 * quotes, backslashes and `%` replaced; `filename*` keeps the full name.
 * `name` is made safe with {@link safeDownloadName} first.
 */
export function contentDisposition(
  name: string,
  mimeType: string,
  type: 'attachment' | 'inline' = 'attachment',
): string {
  const safe = safeDownloadName(name, mimeType);
  const ascii =
    safe
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/["\\%]/g, '_')
      .trim() || 'download';
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeRfc8187(safe)}`;
}

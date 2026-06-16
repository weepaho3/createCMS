/**
 * Parses a raw PGlite timestamp string into a UTC Date.
 * PGlite's `db.execute()` returns `timestamp` columns as strings without
 * timezone indicator (e.g. '2026-04-08 13:24:01.639'). `new Date(str)` would
 * parse that as local time. Appending 'Z' forces UTC interpretation.
 */
export function parseTimestamp(value: unknown): Date {
  if (value instanceof Date) return value;
  const s = String(value);
  return new Date(s.endsWith('Z') ? s : s + 'Z');
}

export function parseTimestampOrNull(value: unknown): Date | null {
  if (value == null) return null;
  return parseTimestamp(value);
}

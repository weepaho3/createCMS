import type { MediaConfig } from '../types/s3';

/** The endpoint a token redeems at. */
export type UploadTokenAudience =
  | 'completeUpload'
  | 'commitRendition'
  | 'commitReplace';

/**
 * What every token binds besides the object: the endpoint it redeems at
 * (`aud`) and the host it was minted on (`host`, `null` for server calls
 * without a request), so a token never redeems at another endpoint or on
 * another host sharing the upload secret.
 */
type TokenBinding = { aud: UploadTokenAudience; host: string | null };

/**
 * Claims a presign call binds to one object key. `scope` is the
 * `scopeFingerprint` of the caller's assets insert columns; `exp` is the
 * signed-URL expiry in epoch milliseconds.
 */
export type UploadTokenPayload = TokenBinding &
  (
    | {
        kind: 'upload';
        id: string;
        name: string;
        objectKey: string;
        type: string;
        size: number;
        folderId: string | null;
        variantOf: string | null;
        /** Canonical variant key; absent in tokens minted without one. */
        variantKey?: string | null;
        /** Base64 SHA-256 the PUT was signed with (`x-amz-checksum-sha256`). */
        sha256?: string | null;
        /** Status of the new row; renditions take their original's. */
        status?: 'public' | 'private';
        actor: string | null;
        scope: string;
        exp: number;
      }
    | {
        kind: 'replace';
        assetId: string;
        slug: string;
        objectKey: string;
        type: string;
        size: number;
        actor: string | null;
        scope: string;
        exp: number;
      }
  );

/** Milliseconds a token stays valid after `exp`, so a PUT in flight at expiry can still be completed. */
export const UPLOAD_TOKEN_GRACE_MS = 3_600_000;

const DERIVATION_INFO = 'createcms-upload-token';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const derivedKeys = new WeakMap<MediaConfig, Promise<CryptoKey>>();

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64url'));
}

async function importHmacKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    raw as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * HMAC key for upload tokens. `config.uploadSecret` is used verbatim when
 * set; otherwise the key is `HMAC-SHA256(secretAccessKey, 'createcms-upload-token')`,
 * so the access key secret itself never signs tokens. Cached per config object.
 */
export function deriveUploadKey(config: MediaConfig): Promise<CryptoKey> {
  const cached = derivedKeys.get(config);
  if (cached) return cached;

  const pending = (async () => {
    if (config.uploadSecret) {
      return importHmacKey(encoder.encode(config.uploadSecret));
    }
    const base = await importHmacKey(encoder.encode(config.secretAccessKey));
    const derived = await crypto.subtle.sign(
      'HMAC',
      base,
      encoder.encode(DERIVATION_INFO),
    );
    return importHmacKey(new Uint8Array(derived));
  })();

  derivedKeys.set(config, pending);
  return pending;
}

/** `base64url(json) + '.' + base64url(HMAC-SHA256(key, base64url(json)))`. */
export async function mintUploadToken(
  key: CryptoKey,
  payload: UploadTokenPayload,
): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function isPayload(value: unknown): value is UploadTokenPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const common =
    typeof v.objectKey === 'string' &&
    typeof v.type === 'string' &&
    typeof v.size === 'number' &&
    (v.actor === null || typeof v.actor === 'string') &&
    typeof v.scope === 'string' &&
    typeof v.exp === 'number' &&
    (v.aud === 'completeUpload' ||
      v.aud === 'commitRendition' ||
      v.aud === 'commitReplace') &&
    (v.host === null || typeof v.host === 'string');
  if (!common) return false;
  if (v.kind === 'upload') {
    return (
      typeof v.id === 'string' &&
      typeof v.name === 'string' &&
      (v.folderId === null || typeof v.folderId === 'string') &&
      (v.variantOf === null || typeof v.variantOf === 'string')
    );
  }
  if (v.kind === 'replace') {
    return typeof v.assetId === 'string' && typeof v.slug === 'string';
  }
  return false;
}

/**
 * Returns the payload, or `null` when the token is malformed, the signature
 * does not match, or `now` is past `exp + UPLOAD_TOKEN_GRACE_MS`.
 */
export async function verifyUploadToken(
  key: CryptoKey,
  token: string,
  now: number = Date.now(),
): Promise<UploadTokenPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, signature] = parts;
  const given = fromBase64Url(signature);
  const expected = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(body)),
  );
  if (!constantTimeEqual(given, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(fromBase64Url(body)));
  } catch {
    return null;
  }
  if (!isPayload(parsed)) return null;
  if (now > parsed.exp + UPLOAD_TOKEN_GRACE_MS) return null;
  return parsed;
}

/**
 * Whether a verified token redeems here: at one of `aud` and on `host`
 * (the request's host, `null` without a request).
 */
export function isTokenBoundTo(
  payload: UploadTokenPayload,
  aud: UploadTokenAudience | readonly UploadTokenAudience[],
  host: string | null,
): boolean {
  const audiences: readonly UploadTokenAudience[] =
    typeof aud === 'string' ? [aud] : aud;
  return audiences.includes(payload.aud) && payload.host === host;
}

/** SHA-256 hex of the insert columns, entries sorted by key; `{}` when undefined. */
export async function scopeFingerprint(
  insertColumns: Record<string, unknown> | undefined,
): Promise<string> {
  const entries = Object.entries(insertColumns ?? {}).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(JSON.stringify(entries)),
  );
  return Buffer.from(digest).toString('hex');
}

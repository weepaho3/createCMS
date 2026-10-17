import { XMLParser } from 'fast-xml-parser';
import slugify from 'slugify';

import type { ObjectAcl, S3Client } from '../../types/s3';

import {
  isRetryable,
  parseRetryAfter,
  withRetry,
  type WithRetryOptions,
} from '../../../utils/retry';
import { StorageError } from '../adapter';

export function parseXml<T = Record<string, unknown>>(
  xml: string,
  params?: {
    ignoreAttributes?: boolean;
    arrayPath?: string[];
  },
): T {
  const parser = new XMLParser({
    ignoreAttributes: params?.ignoreAttributes ?? true,
    isArray: (_, path) => params?.arrayPath?.includes(String(path)) ?? false,
  });
  return parser.parse(xml) as T;
}

export class S3Error extends StorageError {
  constructor(message: string) {
    super(message);
    this.name = 'S3Error';
  }
}

export async function throwS3Error(fn: Promise<Response>): Promise<Response> {
  const res = await fn;

  if (!res.ok) {
    const text = await res.text();
    try {
      const parsed = parseXml<{
        Error: { Code: string; Message: string };
      }>(text);
      throw new S3Error(`${parsed.Error.Code} - ${parsed.Error.Message}`);
    } catch (error) {
      if (error instanceof S3Error) throw error;
      throw new S3Error(
        `S3 request failed with status ${res.status}: ${text.slice(0, 200)}`,
      );
    }
  }

  return res;
}

class RetryableResponse extends Error {
  constructor(readonly response: Response) {
    super(`S3 request failed with status ${response.status}`);
    this.name = 'RetryableResponse';
  }
}

/** Attempts per idempotent server-side S3 request (HEAD, GET, DELETE). */
const S3_ATTEMPTS = 3;

/**
 * `client.s3.fetch` with full-jitter retries on network errors and on 408,
 * 429 and 5xx responses. Only for idempotent requests whose body can be
 * resent. After the last attempt the final response is returned as-is, so
 * callers report it through `throwS3Error`.
 */
export async function fetchWithRetry(
  client: S3Client,
  url: string,
  init: RequestInit,
  options?: Pick<WithRetryOptions, 'sleep' | 'random'>,
): Promise<Response> {
  try {
    return await withRetry(
      async () => {
        const res = await client.s3.fetch(url, init);
        if (isRetryable({ status: res.status })) {
          throw new RetryableResponse(res);
        }
        return res;
      },
      {
        attempts: S3_ATTEMPTS,
        classify: (err) =>
          err instanceof RetryableResponse
            ? {
                retry: true,
                retryAfterMs: parseRetryAfter(
                  err.response.headers.get('retry-after'),
                ),
              }
            : { retry: true },
        onRetry: (err) => {
          if (err instanceof RetryableResponse) {
            void err.response.body?.cancel();
          }
        },
        ...options,
      },
    );
  } catch (err) {
    if (err instanceof RetryableResponse) return err.response;
    throw err;
  }
}

export function baseSignedUrl(
  base: string,
  params: { expiresIn: number },
): URL {
  const url = new URL(base);
  url.searchParams.set('X-Amz-Expires', params.expiresIn.toString());
  return url;
}

export async function signPutObject(
  client: S3Client,
  params: {
    bucket: string;
    key: string;
    contentType: string;
    contentLength: number;
    expiresIn: number;
    acl?: ObjectAcl;
    cacheControl?: string;
    sha256?: string;
  },
): Promise<string> {
  const url = baseSignedUrl(
    `${client.buildBucketUrl(params.bucket)}/${params.key}`,
    { expiresIn: params.expiresIn },
  );
  url.searchParams.set('X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD');

  const headers: Record<string, string> = {
    'content-length': params.contentLength.toString(),
    'content-type': params.contentType,
  };
  if (params.acl) headers['x-amz-acl'] = params.acl;
  if (params.cacheControl) headers['cache-control'] = params.cacheControl;
  if (params.sha256) headers['x-amz-checksum-sha256'] = params.sha256;

  return (
    await client.s3.sign(url.toString(), {
      method: 'PUT',
      headers,
      aws: { signQuery: true, allHeaders: true },
    })
  ).url;
}

/**
 * Presigns a GET. `responseContentDisposition` is bound into the signature
 * as the `response-content-disposition` query parameter, so the bucket
 * answers with that `Content-Disposition` header.
 */
export async function signGetObject(
  client: S3Client,
  params: {
    bucket: string;
    key: string;
    expiresIn: number;
    responseContentDisposition?: string;
    responseContentType?: string;
  },
): Promise<string> {
  const url = baseSignedUrl(
    `${client.buildBucketUrl(params.bucket)}/${params.key}`,
    { expiresIn: params.expiresIn },
  );
  // aws4fetch 1.0.20 keeps preset query params in the canonical query.
  if (params.responseContentDisposition) {
    url.searchParams.set(
      'response-content-disposition',
      params.responseContentDisposition,
    );
  }
  if (params.responseContentType) {
    url.searchParams.set('response-content-type', params.responseContentType);
  }
  const signed = await client.s3.sign(url.toString(), {
    method: 'GET',
    aws: { signQuery: true },
  });
  // aws4fetch signs spaces as `%20` but serialises the URL through
  // `URLSearchParams`, which writes them as `+`; S3 does not decode `+` as a
  // space in the query, so the signature would not match. A literal `+` is
  // serialised as `%2B`, so every remaining `+` is a space.
  return signed.url.replace(/\+/g, '%20');
}

export async function putObject(
  client: S3Client,
  params: {
    bucket: string;
    key: string;
    body: ArrayBuffer | Blob;
    contentType: string;
    contentLength: number;
    acl?: ObjectAcl;
    cacheControl?: string;
    ifNoneMatch?: boolean;
  },
): Promise<Response> {
  const url = `${client.buildBucketUrl(params.bucket)}/${params.key}`;

  const headers: Record<string, string> = {
    'content-type': params.contentType,
    'content-length': params.contentLength.toString(),
  };
  if (params.acl) headers['x-amz-acl'] = params.acl;
  if (params.cacheControl) headers['cache-control'] = params.cacheControl;
  if (params.ifNoneMatch) headers['if-none-match'] = '*';

  return throwS3Error(
    client.s3.fetch(url, {
      method: 'PUT',
      headers,
      body: params.body,
    }),
  );
}

export async function deleteObject(
  client: S3Client,
  params: { bucket: string; key: string },
): Promise<Response> {
  const url = `${client.buildBucketUrl(params.bucket)}/${params.key}`;

  return throwS3Error(fetchWithRetry(client, url, { method: 'DELETE' }));
}

/**
 * HEADs an object. Returns `null` when the bucket answers 404; throws
 * `S3Error` on any other non-2xx response.
 */
export async function headObject(
  client: S3Client,
  params: { bucket: string; key: string },
): Promise<{
  contentLength: number | null;
  contentType: string | null;
  cacheControl: string | null;
} | null> {
  const url = `${client.buildBucketUrl(params.bucket)}/${params.key}`;
  const res = await fetchWithRetry(client, url, { method: 'HEAD' });
  if (res.status === 404) return null;
  await throwS3Error(Promise.resolve(res));
  const len = res.headers.get('content-length');
  return {
    contentLength: len === null ? null : Number(len),
    contentType: res.headers.get('content-type'),
    cacheControl: res.headers.get('cache-control'),
  };
}

/**
 * Server-side `CopyObject`. Without `metadata` the destination keeps the
 * source's content type and cache control (directive `COPY`); with it, both
 * are replaced (directive `REPLACE`). S3 can answer 200 with an `<Error>`
 * body, which is reported like a failed status.
 */
export async function copyObject(
  client: S3Client,
  params: {
    bucket: string;
    sourceKey: string;
    destinationKey: string;
    metadata?: { contentType: string; cacheControl: string };
  },
): Promise<void> {
  const url = `${client.buildBucketUrl(params.bucket)}/${params.destinationKey}`;
  const source = `/${params.bucket}/${params.sourceKey
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
  const headers: Record<string, string> = { 'x-amz-copy-source': source };
  if (params.metadata) {
    headers['x-amz-metadata-directive'] = 'REPLACE';
    headers['content-type'] = params.metadata.contentType;
    headers['cache-control'] = params.metadata.cacheControl;
  }
  const res = await throwS3Error(
    fetchWithRetry(client, url, { method: 'PUT', headers }),
  );
  const text = await res.text();
  if (text.includes('<Error>')) {
    const parsed = parseXml<{ Error: { Code: string; Message: string } }>(text);
    throw new S3Error(`${parsed.Error.Code} - ${parsed.Error.Message}`);
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function sha256Base64(body: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(body),
  );
  let binary = '';
  for (const byte of new Uint8Array(digest))
    binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** `DeleteObjects` in quiet mode, 1000 keys per request. */
export async function deleteObjects(
  client: S3Client,
  params: { bucket: string; keys: string[] },
): Promise<void> {
  for (let i = 0; i < params.keys.length; i += 1000) {
    const batch = params.keys.slice(i, i + 1000);
    const body =
      '<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>' +
      batch
        .map((key) => `<Object><Key>${escapeXml(key)}</Key></Object>`)
        .join('') +
      '</Delete>';
    const res = await throwS3Error(
      fetchWithRetry(
        client,
        `${client.buildBucketUrl(params.bucket)}/?delete`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/xml',
            'x-amz-checksum-sha256': await sha256Base64(body),
            'x-amz-sdk-checksum-algorithm': 'SHA256',
          },
          body,
        },
      ),
    );
    const text = await res.text();
    if (text.includes('<Error>')) {
      const parsed = parseXml<{
        DeleteResult: {
          Error:
            | { Key: string; Code: string }
            | { Key: string; Code: string }[];
        };
      }>(text, { arrayPath: ['DeleteResult.Error'] });
      const errors = [parsed.DeleteResult.Error].flat();
      throw new S3Error(
        `DeleteObjects failed for ${errors.length} key(s): ${errors
          .slice(0, 3)
          .map((e) => `${e.Key} (${e.Code})`)
          .join(', ')}`,
      );
    }
  }
}

/** One `ListObjectsV2` page under `prefix`. */
export async function listObjects(
  client: S3Client,
  params: {
    bucket: string;
    prefix: string;
    cursor?: string | null;
    limit?: number;
  },
): Promise<{
  keys: { key: string; size: number; lastModified: Date | null }[];
  cursor: string | null;
}> {
  const url = new URL(`${client.buildBucketUrl(params.bucket)}/`);
  url.searchParams.set('list-type', '2');
  url.searchParams.set('prefix', params.prefix);
  url.searchParams.set(
    'max-keys',
    String(Math.min(params.limit ?? 1000, 1000)),
  );
  if (params.cursor) url.searchParams.set('continuation-token', params.cursor);
  const res = await throwS3Error(
    fetchWithRetry(client, url.toString(), { method: 'GET' }),
  );
  const parsed = parseXml<{
    ListBucketResult: {
      Contents?: {
        Key: string | number;
        Size: number;
        LastModified?: string;
      }[];
      IsTruncated?: boolean | string;
      NextContinuationToken?: string;
    };
  }>(await res.text(), { arrayPath: ['ListBucketResult.Contents'] });
  const result = parsed.ListBucketResult;
  const truncated = String(result.IsTruncated) === 'true';
  return {
    keys: (result.Contents ?? []).map((item) => ({
      key: String(item.Key),
      size: item.Size,
      lastModified: item.LastModified ? new Date(item.LastModified) : null,
    })),
    cursor: truncated ? (result.NextContinuationToken ?? null) : null,
  };
}

/**
 * GETs `bytes=<start>-<end>` of an object. Returns `null` when the bucket
 * answers 404; throws `S3Error` on any other non-2xx response. A 200 (range
 * ignored) is sliced to the requested length.
 */
export async function getObjectRange(
  client: S3Client,
  params: { bucket: string; key: string; start: number; end: number },
): Promise<Uint8Array | null> {
  const url = `${client.buildBucketUrl(params.bucket)}/${params.key}`;
  const res = await fetchWithRetry(client, url, {
    method: 'GET',
    headers: { range: `bytes=${params.start}-${params.end}` },
  });
  if (res.status === 404) return null;
  await throwS3Error(Promise.resolve(res));
  const bytes = new Uint8Array(await res.arrayBuffer());
  const length = params.end - params.start + 1;
  if (res.status === 206 || bytes.length <= length) return bytes;
  return bytes.slice(params.start, params.start + length);
}

export function buildPublicObjectUrl(
  publicBaseUrl: string,
  key: string,
): string {
  const base = publicBaseUrl.endsWith('/')
    ? publicBaseUrl.slice(0, -1)
    : publicBaseUrl;
  return `${base}/${key}`;
}

export function isFileTypeAllowed(
  fileType: string,
  allowedFileTypes: string[],
): boolean {
  return allowedFileTypes.some((type) => {
    if (type.endsWith('/*')) {
      // Match on the full `type/` prefix, not the bare group: comparing
      // against `'image'` would let `'imagexml/evil'` slip through a
      // startsWith check. The trailing slash pins the match to the real MIME
      // group boundary.
      const prefix = type.slice(0, type.indexOf('/*'));
      return prefix.length > 0 && fileType.startsWith(`${prefix}/`);
    }
    return type === fileType;
  });
}

export function createSlug(text: string): string {
  const trimmed = text.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex > 0) {
    const name = trimmed.slice(0, dotIndex).replace(/\./g, '-');
    const ext = trimmed.slice(dotIndex).toLowerCase();
    return slugify(name, { lower: true, strict: true, trim: true }) + ext;
  }
  return slugify(trimmed, { lower: true, strict: true, trim: true });
}

/**
 * The S3 object key for an asset: `<id>/<slug of fileName>`. Unique by the
 * fresh id alone, so two assets never share an object even when their slugs
 * match (slugs are unique only per scope). Scope isolation is enforced by the
 * plugin-owned scope column and `scope.assets.where`, never by the key.
 */
export function buildUploadObjectKey(id: string, fileName: string): string {
  return `${id}/${createSlug(fileName)}`;
}

export function buildVariantSlug(
  baseSlug: string,
  format?: string,
  width?: number,
): string {
  const dotIndex = baseSlug.lastIndexOf('.');
  const base = dotIndex > 0 ? baseSlug.slice(0, dotIndex) : baseSlug;
  const ext = dotIndex > 0 ? baseSlug.slice(dotIndex) : '';

  const parts: string[] = [];
  if (width) parts.push(`${width}`);
  if (format) parts.push(format);

  if (parts.length === 0) return baseSlug;

  const newExt = format ? `.${format}` : ext;
  return `${base}-${parts.join('-')}${newExt}`;
}

export function getAWSHost(region: string): string {
  return `s3.${region}.amazonaws.com`;
}

export function getDigitalOceanHost(region: string): string {
  return `${region}.digitaloceanspaces.com`;
}

export function getCloudflareHost(
  accountId: string,
  jurisdiction?: string,
): string {
  return `${accountId}.${jurisdiction ? `${jurisdiction}.` : ''}r2.cloudflarestorage.com`;
}

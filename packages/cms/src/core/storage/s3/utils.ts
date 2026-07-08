import { XMLParser } from 'fast-xml-parser';
import slugify from 'slugify';

import type { ObjectAcl, S3Client } from '../../types/s3';

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

export class S3Error extends Error {
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
  },
): Promise<string> {
  const url = baseSignedUrl(
    `${client.buildBucketUrl(params.bucket)}/${params.key}`,
    { expiresIn: params.expiresIn },
  );
  url.searchParams.set('X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD');

  return (
    await client.s3.sign(url.toString(), {
      method: 'PUT',
      headers: {
        'content-length': params.contentLength.toString(),
        'content-type': params.contentType,
        ...(params.acl ? { 'x-amz-acl': params.acl } : {}),
      },
      aws: { signQuery: true, allHeaders: true },
    })
  ).url;
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
  },
): Promise<Response> {
  const url = `${client.buildBucketUrl(params.bucket)}/${params.key}`;

  return throwS3Error(
    client.s3.fetch(url, {
      method: 'PUT',
      headers: {
        'content-type': params.contentType,
        'content-length': params.contentLength.toString(),
        ...(params.acl ? { 'x-amz-acl': params.acl } : {}),
      },
      body: params.body,
    }),
  );
}

export async function deleteObject(
  client: S3Client,
  params: { bucket: string; key: string },
): Promise<Response> {
  const url = `${client.buildBucketUrl(params.bucket)}/${params.key}`;

  return throwS3Error(
    client.s3.fetch(url, {
      method: 'DELETE',
    }),
  );
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
      // Match on the FULL `type/` prefix, not the bare group: comparing against
      // `'image'` would let `'imagexml/evil'` slip through `startsWith`. The
      // trailing slash pins the match to the real MIME group boundary.
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
 * The S3 object key for an asset. Currently the asset slug verbatim — core does
 * not partition object keys by any scope. Scope isolation (e.g. multi-tenant) is
 * enforced by the plugin-owned scope COLUMN + scope.assets.where, never by the
 * key string. This is the single place to evolve key derivation if per-scope
 * partitioning is ever genuinely needed (with tests).
 */
export function buildObjectKey(assetSlug: string): string {
  return assetSlug;
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

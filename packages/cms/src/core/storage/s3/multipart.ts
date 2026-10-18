import type { S3Client } from '../../types/s3';

import {
  baseSignedUrl,
  fetchWithRetry,
  parseXml,
  S3Error,
  throwS3Error,
} from './utils';

type ObjectAcl = 'private' | 'public-read';

const objectUrl = (client: S3Client, bucket: string, key: string) =>
  `${client.buildBucketUrl(bucket)}/${key}`;

/** `CreateMultipartUpload`; returns the upload id. */
export async function createMultipartUpload(
  client: S3Client,
  params: {
    bucket: string;
    key: string;
    contentType: string;
    acl?: ObjectAcl;
    cacheControl?: string;
  },
): Promise<string> {
  const headers: Record<string, string> = {
    'content-type': params.contentType,
  };
  if (params.acl) headers['x-amz-acl'] = params.acl;
  if (params.cacheControl) headers['cache-control'] = params.cacheControl;
  const res = await throwS3Error(
    client.s3.fetch(`${objectUrl(client, params.bucket, params.key)}?uploads`, {
      method: 'POST',
      headers,
    }),
  );
  const parsed = parseXml<{
    InitiateMultipartUploadResult?: { UploadId?: string | number };
  }>(await res.text());
  const uploadId = parsed.InitiateMultipartUploadResult?.UploadId;
  if (uploadId === undefined || uploadId === '') {
    throw new S3Error('CreateMultipartUpload returned no UploadId');
  }
  return String(uploadId);
}

/**
 * Presigns one `UploadPart`. The signature binds the part's exact
 * `content-length`, so a larger or smaller body is refused by the bucket.
 */
export async function signUploadPart(
  client: S3Client,
  params: {
    bucket: string;
    key: string;
    uploadId: string;
    partNumber: number;
    contentLength: number;
    expiresIn: number;
  },
): Promise<string> {
  const url = baseSignedUrl(objectUrl(client, params.bucket, params.key), {
    expiresIn: params.expiresIn,
  });
  url.searchParams.set('partNumber', String(params.partNumber));
  url.searchParams.set('uploadId', params.uploadId);
  url.searchParams.set('X-Amz-Content-Sha256', 'UNSIGNED-PAYLOAD');
  return (
    await client.s3.sign(url.toString(), {
      method: 'PUT',
      headers: { 'content-length': String(params.contentLength) },
      aws: { signQuery: true, allHeaders: true },
    })
  ).url;
}

export type UploadedPart = { partNumber: number; size: number; etag: string };

/** One `ListParts` page (up to 1000 parts) after `marker`. */
export async function listUploadParts(
  client: S3Client,
  params: {
    bucket: string;
    key: string;
    uploadId: string;
    marker?: number | null;
  },
): Promise<{ parts: UploadedPart[]; marker: number | null }> {
  const url = new URL(objectUrl(client, params.bucket, params.key));
  url.searchParams.set('uploadId', params.uploadId);
  url.searchParams.set('max-parts', '1000');
  if (params.marker) {
    url.searchParams.set('part-number-marker', String(params.marker));
  }
  const res = await throwS3Error(
    fetchWithRetry(client, url.toString(), { method: 'GET' }),
  );
  const parsed = parseXml<{
    ListPartsResult: {
      Part?: {
        PartNumber: number | string;
        Size: number | string;
        ETag: string | number;
      }[];
      IsTruncated?: boolean | string;
      NextPartNumberMarker?: number | string;
    };
  }>(await res.text(), { arrayPath: ['ListPartsResult.Part'] });
  const result = parsed.ListPartsResult;
  return {
    parts: (result.Part ?? []).map((part) => ({
      partNumber: Number(part.PartNumber),
      size: Number(part.Size),
      etag: String(part.ETag),
    })),
    marker:
      String(result.IsTruncated) === 'true'
        ? Number(result.NextPartNumberMarker ?? 0) || null
        : null,
  };
}

/** `CompleteMultipartUpload` with the parts in order. */
export async function completeMultipartUpload(
  client: S3Client,
  params: {
    bucket: string;
    key: string;
    uploadId: string;
    parts: { partNumber: number; etag: string }[];
  },
): Promise<void> {
  const body =
    '<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload>' +
    params.parts
      .map(
        (part) =>
          `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${part.etag
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/"/g, '&quot;')}</ETag></Part>`,
      )
      .join('') +
    '</CompleteMultipartUpload>';
  const url = `${objectUrl(client, params.bucket, params.key)}?uploadId=${encodeURIComponent(params.uploadId)}`;
  const res = await throwS3Error(
    client.s3.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/xml' },
      body,
    }),
  );
  // S3 can answer 200 with an error document after a long completion.
  const text = await res.text();
  if (text.includes('<Error>')) {
    const parsed = parseXml<{ Error: { Code: string; Message: string } }>(text);
    throw new S3Error(`${parsed.Error.Code} - ${parsed.Error.Message}`);
  }
}

/** `AbortMultipartUpload`; an unknown upload is not an error. */
export async function abortMultipartUpload(
  client: S3Client,
  params: { bucket: string; key: string; uploadId: string },
): Promise<void> {
  const url = `${objectUrl(client, params.bucket, params.key)}?uploadId=${encodeURIComponent(params.uploadId)}`;
  const res = await fetchWithRetry(client, url, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) await throwS3Error(Promise.resolve(res));
}

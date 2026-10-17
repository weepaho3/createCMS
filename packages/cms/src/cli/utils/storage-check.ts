import type { StorageAdapter } from '../../core/storage/adapter';
import type { MediaConfig } from '../../core/types/s3';

import {
  assetObjectKey,
  cacheControlFor,
  uploadAcl,
  visibilityMode,
} from '../../core/media/placement';
import { buildPublicObjectUrl } from '../../core/storage/s3/utils';

export type CheckStatus = 'pass' | 'fail' | 'skip';

export type CheckResult = {
  name: string;
  status: CheckStatus;
  detail: string;
  /** A copyable configuration that fixes a failed check. */
  fix?: string;
};

export type StorageCheckDeps = {
  config: MediaConfig;
  storage: StorageAdapter;
  /** Signed requests against the bucket; absent for a custom adapter. */
  s3?: {
    bucketUrl: string;
    fetch: (url: string, init?: RequestInit) => Promise<Response>;
  };
  /** Unsigned requests, as a browser or CDN makes them. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** The admin origin uploads come from, e.g. `https://admin.example.com`. */
  origin?: string;
  /** A random suffix for the probe object keys. */
  randomId: () => string;
};

const LIFECYCLE_FIX = JSON.stringify(
  {
    Rules: [
      {
        ID: 'abort-incomplete-multipart-uploads',
        Status: 'Enabled',
        Filter: { Prefix: '' },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
      },
    ],
  },
  null,
  2,
);

function corsFix(origin: string): string {
  return JSON.stringify(
    {
      CORSRules: [
        {
          AllowedOrigins: [origin],
          AllowedMethods: ['PUT', 'GET'],
          AllowedHeaders: ['content-type', 'cache-control'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
    null,
    2,
  );
}

function policyFix(bucket: string, prefix: string): string {
  return JSON.stringify(
    {
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'PublicReadPub',
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${bucket}/${prefix}pub/*`,
        },
      ],
    },
    null,
    2,
  );
}

async function checkCapabilities(deps: StorageCheckDeps): Promise<CheckResult> {
  const c = deps.storage.capabilities;
  const flags = [
    ['signedPut', c.signedPut.supported],
    ['signedGet', c.signedGet.supported],
    ['rangeRead', c.rangeRead],
    ['copy', c.copy],
    ['list', c.list],
    ['deleteMany', c.deleteMany],
    ['objectAcl', c.objectAcl],
    ['lifecycle', c.lifecycle],
    ['corsConfigurable', c.corsConfigurable],
  ] as const;
  const missingForPrefix = visibilityMode(deps.config) === 'prefix' && !c.copy;
  return {
    name: 'Capabilities',
    status: missingForPrefix ? 'fail' : 'pass',
    detail: `${deps.storage.name}: ${flags
      .map(([name, on]) => `${name} ${on ? 'yes' : 'no'}`)
      .join(', ')}`,
    fix: missingForPrefix
      ? "visibility 'prefix' needs the copy capability; set media.visibility: 'legacy' or use a storage that can copy."
      : undefined,
  };
}

async function checkLifecycle(deps: StorageCheckDeps): Promise<CheckResult> {
  const name = 'Lifecycle rule for incomplete multipart uploads';
  if (!deps.storage.capabilities.lifecycle) {
    return {
      name,
      status: 'skip',
      detail:
        'The provider has no lifecycle API; abandoned multipart uploads are not cleaned up by the bucket.',
    };
  }
  if (!deps.s3) {
    return { name, status: 'skip', detail: 'Custom storage adapter.' };
  }
  const res = await deps.s3.fetch(`${deps.s3.bucketUrl}/?lifecycle`);
  const body = await res.text();
  if (res.ok && body.includes('AbortIncompleteMultipartUpload')) {
    return {
      name,
      status: 'pass',
      detail: 'AbortIncompleteMultipartUpload is set.',
    };
  }
  return {
    name,
    status: 'fail',
    detail: res.ok
      ? 'The lifecycle configuration has no AbortIncompleteMultipartUpload rule.'
      : `No lifecycle configuration (HTTP ${res.status}).`,
    fix: LIFECYCLE_FIX,
  };
}

async function checkCors(
  deps: StorageCheckDeps,
  probeUrl: string,
): Promise<CheckResult> {
  const name = 'CORS for uploads from the admin origin';
  if (!deps.origin) {
    return {
      name,
      status: 'skip',
      detail: 'Pass --origin <admin origin> to check the CORS preflight.',
    };
  }
  const res = await deps.fetch(probeUrl, {
    method: 'OPTIONS',
    headers: {
      Origin: deps.origin,
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type,cache-control',
    },
  });
  const allowOrigin = res.headers.get('access-control-allow-origin');
  const allowHeaders = (
    res.headers.get('access-control-allow-headers') ?? ''
  ).toLowerCase();
  const originOk = allowOrigin === '*' || allowOrigin === deps.origin;
  const headersOk =
    allowHeaders === '*' ||
    (allowHeaders.includes('content-type') &&
      allowHeaders.includes('cache-control'));
  if (res.ok && originOk && headersOk) {
    return {
      name,
      status: 'pass',
      detail: `PUT from ${deps.origin} is allowed.`,
    };
  }
  return {
    name,
    status: 'fail',
    detail: !originOk
      ? `The preflight does not allow ${deps.origin} (HTTP ${res.status}).`
      : 'The preflight does not allow the content-type and cache-control headers.',
    fix: deps.storage.capabilities.corsConfigurable
      ? corsFix(deps.origin)
      : 'The provider sets CORS outside the S3 API; allow PUT and GET with the headers content-type and cache-control in its dashboard.',
  };
}

async function checkUploadAndPolicy(
  deps: StorageCheckDeps,
): Promise<CheckResult[]> {
  const { config, storage } = deps;
  const id = `createcms-check-${deps.randomId()}`;
  const body = new TextEncoder().encode('createcms storage check');
  const prefix = visibilityMode(config) === 'prefix';
  const keys = {
    private: assetObjectKey(config, {
      id,
      fileName: 'probe.txt',
      visibility: 'private',
    }),
    public: assetObjectKey(config, {
      id,
      fileName: 'probe.txt',
      visibility: 'public',
    }),
  };
  const results: CheckResult[] = [];
  const written: string[] = [];
  try {
    for (const visibility of ['private', 'public'] as const) {
      await storage.put(keys[visibility], body, {
        contentType: 'text/plain',
        contentLength: body.byteLength,
        acl: uploadAcl(config, storage),
        cacheControl: cacheControlFor(config, visibility),
      });
      written.push(keys[visibility]);
      if (!prefix) break;
    }
    results.push({
      name: 'Upload without an ACL header',
      status: 'pass',
      detail: `PUT ${keys.private} succeeded${uploadAcl(config, storage) ? ' (with x-amz-acl: public-read)' : ''}.`,
    });
  } catch (err) {
    results.push({
      name: 'Upload without an ACL header',
      status: 'fail',
      detail: `PUT failed: ${err instanceof Error ? err.message : String(err)}`,
      fix: 'Check the credentials and that the key may write to the bucket. On AWS, buckets with "Bucket owner enforced" reject ACL headers; keep media.acl at false.',
    });
    return results;
  }

  if (prefix) {
    const statusOf = async (key: string) =>
      (await deps.fetch(buildPublicObjectUrl(config.publicUrl, key))).status;
    const publicStatus = await statusOf(keys.public);
    const privateStatus = await statusOf(keys.private);
    const ok = publicStatus === 200 && privateStatus >= 400;
    results.push({
      name: 'Public reads on pub/ only',
      status: ok ? 'pass' : 'fail',
      detail: `publicUrl answers ${publicStatus} for pub/ and ${privateStatus} for prv/ (expected 200 and 403).`,
      fix: ok ? undefined : policyFix(config.bucketName, ''),
    });
  }

  try {
    for (const key of written) await storage.delete(key);
  } catch {
    // Probe objects are tiny; a failed cleanup must not fail the check.
  }
  return results;
}

/**
 * Checks a media storage setup: capabilities, the multipart lifecycle rule,
 * the CORS preflight for uploads from `origin`, an upload without ACL
 * headers and, under `visibility: 'prefix'`, that the public URL serves
 * `pub/` but not `prv/`. Writes and deletes two small probe objects.
 */
export async function runStorageCheck(
  deps: StorageCheckDeps,
): Promise<CheckResult[]> {
  const probeUrl = deps.s3
    ? `${deps.s3.bucketUrl}/${assetObjectKey(deps.config, { id: 'createcms-cors-probe', fileName: 'probe.txt', visibility: 'private' })}`
    : buildPublicObjectUrl(deps.config.publicUrl, 'createcms-cors-probe');
  return [
    await checkCapabilities(deps),
    await checkLifecycle(deps),
    await checkCors(deps, probeUrl),
    ...(await checkUploadAndPolicy(deps)),
  ];
}

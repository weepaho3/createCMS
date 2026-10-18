import { createServer, type Server } from 'node:http';

import type { CustomMediaConfig } from '../core/types/s3';

const TEST_BUCKET = 'test-bucket';
const TEST_ACCESS_KEY = 'S3RVER';
const TEST_SECRET_KEY = 'S3RVER';

type StoredObject = {
  body: Buffer;
  contentType?: string;
  cacheControl?: string;
};

export type TestS3 = {
  config: CustomMediaConfig;
  /** Object keys (without bucket prefix) every GET/HEAD/DELETE answers with 500. */
  failKeys: Set<string>;
  /** Object keys (without bucket prefix) a CopyObject from them answers 500. */
  failCopyFrom: Set<string>;
  /**
   * Bucket policy for anonymous reads (no `Authorization` header, no
   * `X-Amz-Signature`): keys for which it returns `false` answer 403.
   * Default: every key is readable.
   */
  publicRead: { allows: (key: string) => boolean };
  /**
   * Per object name (the key's last segment): how many upload PUTs still
   * answer 503 SlowDown. Scoped by name so parallel tests do not interfere.
   */
  slowDown: Map<string, number>;
  /** Per object name: upload PUTs answer only after this many ms. */
  putDelay: Map<string, number>;
  /** Object keys (without bucket prefix) currently stored. */
  keys: () => string[];
  /** Multipart uploads in progress, by upload id. */
  pendingUploads: () => string[];
  /** Per object name: the part numbers stored, in arrival order. */
  storedParts: Map<string, number[]>;
  /** The stored object at `key` (without bucket prefix). */
  object: (key: string) => StoredObject | undefined;
  cleanup: () => Promise<void>;
};

function xmlError(code: string, message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`;
}

function readBody(req: import('node:http').IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * Starts a minimal in-memory S3-compatible HTTP server on a random port.
 * Implements what the media tests exercise: PUT (store, with
 * `x-amz-copy-source` as CopyObject), GET (serve, single-range `Range` as
 * 206), HEAD, DELETE, POST `?delete` (DeleteObjects) and GET `?list-type=2`
 * (ListObjectsV2) and the multipart calls (create, part, list, complete,
 * abort), keyed by the request path. No SigV4 verification, no ACLs. `Content-Type` and `Cache-Control` are stored and
 * returned. Every response allows any origin, so browser tests can PUT to
 * presigned URLs.
 */
export async function setupTestS3(): Promise<TestS3> {
  const store = new Map<string, StoredObject>();
  const failKeys = new Set<string>();
  const failCopyFrom = new Set<string>();
  const publicRead = { allows: (_key: string) => true };
  const slowDown = new Map<string, number>();
  const uploads = new Map<
    string,
    {
      key: string;
      contentType?: string;
      cacheControl?: string;
      parts: Map<number, Buffer>;
    }
  >();
  let nextUploadId = 1;
  const storedParts = new Map<string, number[]>();
  const putDelay = new Map<string, number>();
  const bucketPrefix = `/${TEST_BUCKET}/`;
  const bare = (path: string) =>
    path.startsWith(bucketPrefix) ? path.slice(bucketPrefix.length) : path;

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    // Signed URLs carry ?X-Amz-... query params; the key is the path alone.
    const key = decodeURIComponent(url.pathname);
    const method = req.method ?? 'GET';
    const signed =
      req.headers.authorization !== undefined ||
      url.searchParams.has('X-Amz-Signature');

    // Browsers PUT to presigned URLs cross-origin.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-expose-headers', 'ETag');
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, HEAD, PUT, POST, DELETE',
        'access-control-allow-headers':
          req.headers['access-control-request-headers'] ?? '*',
        'access-control-max-age': '600',
      });
      res.end();
      return;
    }

    // Multipart: CreateMultipartUpload, UploadPart, ListParts,
    // CompleteMultipartUpload, AbortMultipartUpload.
    const uploadId = url.searchParams.get('uploadId');
    if (method === 'POST' && url.searchParams.has('uploads')) {
      const id = `upload-${nextUploadId++}`;
      uploads.set(id, {
        key,
        contentType: req.headers['content-type'],
        cacheControl: req.headers['cache-control'],
        parts: new Map(),
      });
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult><Key>${bare(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`,
      );
      return;
    }
    if (uploadId !== null) {
      const upload = uploads.get(uploadId);
      if (!upload || upload.key !== key) {
        if (method === 'DELETE') {
          res.writeHead(204).end();
          return;
        }
        res.writeHead(404, { 'content-type': 'application/xml' });
        res.end(
          xmlError('NoSuchUpload', 'The specified upload does not exist.'),
        );
        return;
      }
      if (method === 'PUT') {
        const partNumber = Number(url.searchParams.get('partNumber'));
        const name = key.slice(key.lastIndexOf('/') + 1);
        const failures = slowDown.get(name) ?? 0;
        void readBody(req).then(async (body) => {
          if (failures > 0) {
            slowDown.set(name, failures - 1);
            res.writeHead(503, { 'content-type': 'application/xml' });
            res.end(xmlError('SlowDown', 'Please reduce your request rate.'));
            return;
          }
          const delay = putDelay.get(name) ?? 0;
          if (delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
          upload.parts.set(partNumber, body);
          storedParts.set(name, [...(storedParts.get(name) ?? []), partNumber]);
          res.writeHead(200, { ETag: `"part-${partNumber}-${body.length}"` });
          res.end();
        });
        return;
      }
      if (method === 'GET') {
        const marker = Number(url.searchParams.get('part-number-marker') ?? 0);
        const max = Number(url.searchParams.get('max-parts') ?? 1000);
        const numbers = [...upload.parts.keys()]
          .filter((n) => n > marker)
          .sort((a, b) => a - b);
        const page = numbers.slice(0, max);
        const truncated = numbers.length > page.length;
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?><ListPartsResult><UploadId>${uploadId}</UploadId>` +
            page
              .map(
                (n) =>
                  `<Part><PartNumber>${n}</PartNumber><ETag>"part-${n}-${upload.parts.get(n)!.length}"</ETag><Size>${upload.parts.get(n)!.length}</Size></Part>`,
              )
              .join('') +
            `<IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextPartNumberMarker>${page[page.length - 1]}</NextPartNumberMarker>` : ''}</ListPartsResult>`,
        );
        return;
      }
      if (method === 'POST') {
        void readBody(req).then((body) => {
          const numbers = [
            ...body
              .toString('utf8')
              .matchAll(/<PartNumber>(\d+)<\/PartNumber>/g),
          ].map((match) => Number(match[1]));
          if (numbers.some((n) => !upload.parts.has(n))) {
            res.writeHead(400, { 'content-type': 'application/xml' });
            res.end(
              xmlError('InvalidPart', 'One or more parts were not found.'),
            );
            return;
          }
          store.set(key, {
            body: Buffer.concat(numbers.map((n) => upload.parts.get(n)!)),
            contentType: upload.contentType,
            cacheControl: upload.cacheControl,
          });
          uploads.delete(uploadId);
          res.writeHead(200, { 'content-type': 'application/xml' });
          res.end(
            `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUploadResult><Key>${bare(key)}</Key></CompleteMultipartUploadResult>`,
          );
        });
        return;
      }
      if (method === 'DELETE') {
        uploads.delete(uploadId);
        res.writeHead(204).end();
        return;
      }
    }

    if (method === 'POST' && url.searchParams.has('delete')) {
      void readBody(req).then((body) => {
        for (const match of body
          .toString('utf8')
          .matchAll(/<Key>([^<]*)<\/Key>/g)) {
          store.delete(`${bucketPrefix}${match[1]}`);
        }
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(
          '<?xml version="1.0" encoding="UTF-8"?><DeleteResult></DeleteResult>',
        );
      });
      return;
    }

    if (method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const max = Number(url.searchParams.get('max-keys') ?? '1000');
      const after = url.searchParams.get('continuation-token');
      const all = [...store.keys()]
        .map(bare)
        .filter((k) => k.startsWith(prefix))
        .sort();
      const start = after ? all.indexOf(after) + 1 : 0;
      const page = all.slice(start, start + max);
      const truncated = start + max < all.length;
      const contents = page
        .map(
          (k) =>
            `<Contents><Key>${k}</Key><Size>${store.get(`${bucketPrefix}${k}`)!.body.length}</Size></Contents>`,
        )
        .join('');
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>${truncated}</IsTruncated>${contents}${
          truncated
            ? `<NextContinuationToken>${page[page.length - 1]}</NextContinuationToken>`
            : ''
        }</ListBucketResult>`,
      );
      return;
    }

    if (method === 'PUT') {
      const copySource = req.headers['x-amz-copy-source'];
      if (typeof copySource === 'string') {
        const source = decodeURIComponent(copySource);
        const sourceKey = source.startsWith('/') ? source : `/${source}`;
        const obj = store.get(sourceKey);
        if (failCopyFrom.has(bare(sourceKey))) {
          res.writeHead(500, { 'content-type': 'application/xml' });
          res.end(xmlError('InternalError', 'Copy failed.'));
          return;
        }
        if (!obj) {
          res.writeHead(404, { 'content-type': 'application/xml' });
          res.end(xmlError('NoSuchKey', 'The specified key does not exist.'));
          return;
        }
        store.set(
          key,
          req.headers['x-amz-metadata-directive'] === 'REPLACE'
            ? {
                body: obj.body,
                contentType: req.headers['content-type'],
                cacheControl: req.headers['cache-control'],
              }
            : { ...obj },
        );
        res.writeHead(200, { 'content-type': 'application/xml' });
        res.end(
          '<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><ETag>"test-etag"</ETag></CopyObjectResult>',
        );
        return;
      }
      const name = key.slice(key.lastIndexOf('/') + 1);
      const failures = slowDown.get(name) ?? 0;
      if (failures > 0) {
        slowDown.set(name, failures - 1);
        void readBody(req).then(() => {
          res.writeHead(503, { 'content-type': 'application/xml' });
          res.end(xmlError('SlowDown', 'Please reduce your request rate.'));
        });
        return;
      }
      void readBody(req).then(async (body) => {
        const delay = putDelay.get(name) ?? 0;
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
        store.set(key, {
          body,
          contentType: req.headers['content-type'],
          cacheControl: req.headers['cache-control'],
        });
        res.writeHead(200, { ETag: '"test-etag"' });
        res.end();
      });
      return;
    }
    if (failKeys.has(bare(key))) {
      res.writeHead(500, { 'content-type': 'application/xml' });
      res.end(xmlError('InternalError', 'We encountered an internal error.'));
      return;
    }
    if (method === 'DELETE') {
      store.delete(key);
      res.writeHead(204).end();
      return;
    }
    if (method === 'GET' || method === 'HEAD') {
      if (!signed && !publicRead.allows(bare(key))) {
        res.writeHead(403, { 'content-type': 'application/xml' });
        res.end(
          method === 'HEAD'
            ? undefined
            : xmlError('AccessDenied', 'Access Denied'),
        );
        return;
      }
      const obj = store.get(key);
      if (!obj) {
        res.writeHead(404, { 'content-type': 'application/xml' });
        res.end(xmlError('NoSuchKey', 'The specified key does not exist.'));
        return;
      }
      const headers: Record<string, string> = {};
      if (obj.contentType) headers['content-type'] = obj.contentType;
      if (obj.cacheControl) headers['cache-control'] = obj.cacheControl;
      const range = /^bytes=(\d+)-(\d*)$/.exec(
        method === 'GET' ? (req.headers.range ?? '') : '',
      );
      if (range) {
        const start = Number(range[1]);
        const end = Math.min(
          range[2] === '' ? obj.body.length - 1 : Number(range[2]),
          obj.body.length - 1,
        );
        const slice = obj.body.subarray(start, end + 1);
        headers['content-length'] = String(slice.length);
        headers['content-range'] = `bytes ${start}-${end}/${obj.body.length}`;
        res.writeHead(206, headers);
        res.end(slice);
        return;
      }
      headers['content-length'] = String(obj.body.length);
      res.writeHead(200, headers);
      res.end(method === 'HEAD' ? undefined : obj.body);
      return;
    }
    res.writeHead(405).end();
  });

  const port: number = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
  const hostname = `127.0.0.1:${port}`;

  const config: CustomMediaConfig = {
    provider: 'custom',
    hostname,
    region: 'us-east-1',
    accessKeyId: TEST_ACCESS_KEY,
    secretAccessKey: TEST_SECRET_KEY,
    bucketName: TEST_BUCKET,
    publicUrl: `http://${hostname}/${TEST_BUCKET}`,
    secure: false,
    forcePathStyle: true,
  };

  const cleanup = async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return {
    config,
    failKeys,
    failCopyFrom,
    publicRead,
    slowDown,
    putDelay,
    keys: () => [...store.keys()].map(bare),
    pendingUploads: () => [...uploads.keys()],
    storedParts,
    object: (k) => store.get(`${bucketPrefix}${k}`),
    cleanup,
  };
}

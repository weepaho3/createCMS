import { createServer, type Server } from 'node:http';

import type { CustomMediaConfig } from '../core/types/s3';

const TEST_BUCKET = 'test-bucket';
const TEST_ACCESS_KEY = 'S3RVER';
const TEST_SECRET_KEY = 'S3RVER';

export type TestS3 = {
  config: CustomMediaConfig;
  cleanup: () => Promise<void>;
};

/**
 * Starts a minimal in-memory S3-compatible HTTP server on a random port.
 * Implements exactly what the media tests exercise: PUT (store), GET (serve),
 * DELETE (remove), keyed by the request path. No SigV4 verification, no
 * LIST/multipart/ACL. Returns an S3-flavored <Error> XML body on a missing
 * GET.
 */
export async function setupTestS3(): Promise<TestS3> {
  const store = new Map<string, { body: Buffer; contentType?: string }>();

  const server: Server = createServer((req, res) => {
    // Signed URLs carry ?X-Amz-... query params on PUT; strip the query so a
    // signed PUT and a later unsigned GET/DELETE address the same object.
    const key = (req.url ?? '/').split('?')[0];
    const method = req.method ?? 'GET';

    if (method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        store.set(key, {
          body: Buffer.concat(chunks),
          contentType: req.headers['content-type'],
        });
        res.writeHead(200, { ETag: '"test-etag"' });
        res.end();
      });
      return;
    }
    if (method === 'DELETE') {
      store.delete(key);
      res.writeHead(204).end();
      return;
    }
    if (method === 'GET' || method === 'HEAD') {
      const obj = store.get(key);
      if (!obj) {
        res.writeHead(404, { 'content-type': 'application/xml' });
        res.end(
          `<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>`,
        );
        return;
      }
      res.writeHead(
        200,
        obj.contentType ? { 'content-type': obj.contentType } : {},
      );
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

  return { config, cleanup };
}

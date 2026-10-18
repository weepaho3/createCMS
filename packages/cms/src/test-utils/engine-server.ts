import type { TestProject } from 'vitest/node';

import { createServer } from 'node:http';

import { setupTestCMS } from './cms';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Base URL of the test CMS handler (`<cmsUrl>/api/cms/...`). */
    cmsUrl: string;
  }
}

/**
 * Global setup of the engine (browser) tests: a test CMS on PGlite with the
 * in-memory S3 server, behind a Node HTTP server the browser can reach.
 * Every response allows any origin. `/__test/...` routes let a test steer
 * the S3 server per object name (engines run in parallel against this one
 * server): `POST /__test/slow-down?name=x&count=n` makes the next n PUTs of
 * `x` answer 503, `POST /__test/put-delay?name=x&ms=n` delays them,
 * `GET /__test/keys` lists the stored keys.
 */
export default async function setup(project: TestProject) {
  const { cms, s3 } = await setupTestCMS({ withS3: true });
  if (!('keys' in s3))
    throw new Error('The engine tests need the test S3 server');

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('access-control-allow-origin', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, PUT, DELETE',
        'access-control-allow-headers':
          req.headers['access-control-request-headers'] ?? '*',
      });
      res.end();
      return;
    }
    if (url.pathname === '/__test/slow-down') {
      s3.slowDown.set(
        url.searchParams.get('name') ?? '',
        Number(url.searchParams.get('count') ?? 1),
      );
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === '/__test/put-delay') {
      s3.putDelay.set(
        url.searchParams.get('name') ?? '',
        Number(url.searchParams.get('ms') ?? 0),
      );
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === '/__test/keys') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(s3.keys()));
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers.set(name, value);
      }
      const body =
        req.method === 'GET' || req.method === 'HEAD'
          ? undefined
          : Buffer.concat(chunks);
      void cms.router
        .handler(new Request(url, { method: req.method, headers, body }))
        .then(async (response) => {
          const out: Record<string, string> = {};
          response.headers.forEach((value, name) => {
            out[name] = value;
          });
          res.writeHead(response.status, out);
          res.end(Buffer.from(await response.arrayBuffer()));
        })
        .catch((error: unknown) => {
          res.writeHead(500);
          res.end(String(error));
        });
    });
  });
  const port: number = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : 0);
    });
  });
  project.provide('cmsUrl', `http://127.0.0.1:${port}`);

  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await s3.cleanup();
  };
}

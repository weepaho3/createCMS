// Installs every registry item into a fresh Next.js app, the way a consumer
// would, and proves the result compiles and builds:
//
// 1. copy `registry-fixture/` (Next.js 16, Tailwind v4, the docs' shadcn
//    config) to a temporary directory;
// 2. install it with `@createcms/react` packed from this workspace;
// 3. `shadcn add` every item from the built `public/r/<item>.json`,
//    served on a local port with `https://createcms.dev/r/` pointed at it,
//    so `registryDependencies` resolve the way the CLI does for consumers;
// 4. add a page rendering `editor-app` on `createMemoryAdapter`, then
//    `tsc --noEmit`, `next build`, and check the prerendered page.
//
// A broken `registryDependencies` entry, a wrong alias or a missing
// dependency fails one of these steps. Run `bun run registry:build` and
// build `@createcms/react` first.
//
// Usage: node apps/docs/scripts/registry-fixture.mjs [--keep]
import { execFileSync, spawn } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(docs, '../..');
const keep = process.argv.includes('--keep');

const shadcn = JSON.parse(
  readFileSync(path.join(docs, 'node_modules/shadcn/package.json'), 'utf8'),
).version;
const registry = JSON.parse(
  readFileSync(path.join(docs, 'public/r/registry.json'), 'utf8'),
);

/** Runs a command without blocking the event loop (the server below). */
const run = (cmd, args, cwd) =>
  new Promise((resolve, reject) => {
    console.log(`\n$ ${cmd} ${args.join(' ')}`);
    const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: process.env });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`)),
    );
  });

/** Serves `dir` on a free local port; resolves to its base URL. */
const serve = (dir) =>
  new Promise((resolve) => {
    const server = createServer((req, res) => {
      const name = path.basename(new URL(req.url ?? '/', 'http://x').pathname);
      try {
        const body = readFileSync(path.join(dir, name));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}/r/` });
    });
  });

const app = mkdtempSync(path.join(tmpdir(), 'createcms-registry-fixture-'));
console.log(`registry-fixture: ${app}`);
const served = path.join(app, '.registry');
mkdirSync(served);
const { server, base } = await serve(served);
try {
  // The built items with the production registry URL pointed at the local
  // server, so dependencies between items resolve to this build.
  for (const file of readdirSync(path.join(docs, 'public/r'))) {
    const text = readFileSync(path.join(docs, 'public/r', file), 'utf8');
    writeFileSync(
      path.join(served, file),
      text.replaceAll('https://createcms.dev/r/', base),
    );
  }
  cpSync(path.join(docs, 'registry-fixture'), app, { recursive: true });

  // The package as npm would ship it, not the workspace link.
  const react = path.join(repo, 'packages/react');
  const packed = execFileSync(
    'npm',
    ['pack', '--silent', '--pack-destination', app],
    { cwd: react, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .at(-1);
  const pkgPath = path.join(app, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  pkg.dependencies['@createcms/react'] = `file:./${packed}`;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  await run('npm', ['install', '--no-audit', '--no-fund'], app);

  for (const item of registry.items) {
    await run(
      'npx',
      [
        '--yes',
        `shadcn@${shadcn}`,
        'add',
        `${base}${item.name}.json`,
        '--yes',
        '--overwrite',
      ],
      app,
    );
  }

  // `shadcn add` installs the items' pinned `@createcms/react` from npm:
  // point it back at this build.
  const added = JSON.parse(readFileSync(pkgPath, 'utf8'));
  added.dependencies['@createcms/react'] = `file:./${packed}`;
  writeFileSync(pkgPath, `${JSON.stringify(added, null, 2)}\n`);
  await run('npm', ['install', '--no-audit', '--no-fund'], app);

  renameSync(
    path.join(app, 'page.tsx.fixture'),
    path.join(app, 'app/page.tsx'),
  );
  await run('npx', ['tsc', '--noEmit'], app);
  await run('npx', ['next', 'build'], app);
  // The prerendered page carries the editor-app shell (its loading state).
  const html = readFileSync(
    path.join(app, '.next/server/app/index.html'),
    'utf8',
  );
  if (!html.includes('data-slot="editor-app-loading"')) {
    throw new Error('the fixture page does not render editor-app');
  }
  console.log(`\nregistry-fixture: ok (${registry.items.length} items)`);
} finally {
  server.close();
  if (keep) console.log(`registry-fixture: kept ${app}`);
  else rmSync(app, { recursive: true, force: true });
}

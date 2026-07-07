import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  detectProjectLayout,
  resolvePreset,
  scaffoldInit,
} from '../commands/init';
import { PRESETS } from '../templates/init';

/** Write a minimal tsconfig with a single wildcard path alias. */
const writeTsconfig = (dir: string, alias: string, target: string) =>
  writeFile(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { paths: { [alias]: [target] } } }),
    'utf8',
  );

describe('createcms init — scaffoldInit', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'createcms-init-'));
    // Default the tests to the create-next-app src layout (`@/*` → `./src/*`).
    await writeTsconfig(dir, '@/*', './src/*');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const read = (p: string) => readFile(path.join(dir, p), 'utf8');

  it('scaffolds all CMS files into the project', async () => {
    const res = await scaffoldInit({ cwd: dir, preset: PRESETS.pages });

    expect(res.files.map((f) => f.status)).toEqual([
      'created',
      'created',
      'created',
      'created',
    ]);
    const cmsSource = await read('src/lib/cms.ts');
    expect(cmsSource).toContain('createCMS(');
    // dx-07: the deny path uses CMSError (→ 401), not a bare Error (→ HTTP 500).
    expect(cmsSource).toContain("CMSError('UNAUTHORIZED')");
    expect(cmsSource).not.toContain("new Error('Unauthorized')");
    expect(await read('src/cms/collections/pages.ts')).toContain(
      'pagesCollection',
    );
    expect(await read('src/app/api/cms/[[...rest]]/route.ts')).toContain(
      'cms.router',
    );
    expect(await read('.env.example')).toContain('DATABASE_URL=');
  });

  it('is idempotent — a second run skips existing files and never clobbers', async () => {
    await scaffoldInit({ cwd: dir, preset: PRESETS.pages });
    await writeFile(path.join(dir, 'src/lib/cms.ts'), 'CUSTOM', 'utf8');

    const res = await scaffoldInit({ cwd: dir, preset: PRESETS.pages });

    expect(res.files.every((f) => f.status === 'skipped')).toBe(true);
    expect(await read('src/lib/cms.ts')).toBe('CUSTOM'); // not overwritten
  });

  it('adds the cms:generate script to package.json (preserving existing scripts)', async () => {
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { dev: 'next' } }, null, 2),
      'utf8',
    );

    const res = await scaffoldInit({ cwd: dir, preset: PRESETS.pages });

    expect(res.pkg.status).toBe('patched');
    const pkg = JSON.parse(await read('package.json'));
    expect(pkg.scripts['cms:generate']).toBe('createcms generate');
    expect(pkg.scripts.dev).toBe('next');
  });

  it('does not clobber an existing cms:generate script', async () => {
    await writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ scripts: { 'cms:generate': 'custom' } }),
      'utf8',
    );

    const res = await scaffoldInit({ cwd: dir, preset: PRESETS.pages });

    expect(res.pkg.status).toBe('skipped');
    expect(JSON.parse(await read('package.json')).scripts['cms:generate']).toBe(
      'custom',
    );
  });

  it('skips package.json patching when there is none', async () => {
    const res = await scaffoldInit({ cwd: dir, preset: PRESETS.pages });
    expect(res.pkg.status).toBe('skipped');
    expect(res.pkg.reason).toContain('no package.json');
  });

  it('skips (and leaves intact) a malformed or non-object package.json', async () => {
    await writeFile(path.join(dir, 'package.json'), '{ not json', 'utf8');
    let res = await scaffoldInit({ cwd: dir, preset: PRESETS.pages });
    expect(res.pkg.status).toBe('skipped');
    expect(res.pkg.reason).toContain('not valid JSON');
    expect(await read('package.json')).toBe('{ not json'); // untouched

    await writeFile(path.join(dir, 'package.json'), 'null', 'utf8');
    res = await scaffoldInit({ cwd: dir, preset: PRESETS.pages });
    expect(res.pkg.status).toBe('skipped');
    expect(await read('package.json')).toBe('null'); // untouched, no crash
  });

  it('preserves the existing indentation when patching package.json', async () => {
    await writeFile(
      path.join(dir, 'package.json'),
      '{\n\t"name": "demo"\n}\n', // tab-indented
      'utf8',
    );
    await scaffoldInit({ cwd: dir, preset: PRESETS.pages });
    expect(await read('package.json')).toContain('\n\t"'); // still tabs
  });

  it('scaffolds the blog preset (posts collection + wired cms.ts)', async () => {
    await scaffoldInit({ cwd: dir, preset: PRESETS.blog });

    const collection = await read('src/cms/collections/posts.ts');
    expect(collection).toContain('export const postsCollection');
    expect(collection).toContain("type: 'date'"); // publishedAt
    expect(collection).toContain("type: 'image'"); // cover image

    const cms = await read('src/lib/cms.ts');
    expect(cms).toContain(
      "import { postsCollection } from '@/cms/collections/posts'",
    );
    expect(cms).toContain('posts: postsCollection');
  });

  it('scaffolds the docs preset (nested docs collection)', async () => {
    await scaffoldInit({ cwd: dir, preset: PRESETS.docs });

    const collection = await read('src/cms/collections/docs.ts');
    expect(collection).toContain('export const docsCollection');
    expect(collection).toContain('nested: true');
    expect(collection).toContain("type: 'select'"); // callout variant

    const cms = await read('src/lib/cms.ts');
    expect(cms).toContain('docs: docsCollection');
  });
});

// dx-09: the scaffold is not hardcoded to the `src/` layout — it detects the
// project's layout + import alias so files and imports match.
describe('createcms init — layout detection', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'createcms-layout-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const read = (p: string) => readFile(path.join(dir, p), 'utf8');

  it('scaffolds into src/ with `@` when `@/*` → ./src/*', async () => {
    await writeTsconfig(dir, '@/*', './src/*');
    const res = await scaffoldInit({ cwd: dir, preset: PRESETS.pages });

    expect(res.layout).toEqual({ baseDir: 'src', alias: '@', hasAlias: true });
    expect(res.files.map((f) => f.path)).toContain('src/lib/cms.ts');
    const cms = await read('src/lib/cms.ts');
    expect(cms).toContain("from '@/cms/collections/pages'");
    expect(cms).toContain("output: './src/db/schema/cms.ts'");
    await read('src/app/api/cms/[[...rest]]/route.ts'); // exists
  });

  it('scaffolds into the project ROOT when `@/*` → ./*', async () => {
    await writeTsconfig(dir, '@/*', './*');
    const res = await scaffoldInit({ cwd: dir, preset: PRESETS.pages });

    expect(res.layout).toEqual({ baseDir: '', alias: '@', hasAlias: true });
    const paths = res.files.map((f) => f.path);
    expect(paths).toContain('lib/cms.ts');
    expect(paths).toContain('app/api/cms/[[...rest]]/route.ts');
    expect(paths).not.toContain('src/lib/cms.ts');
    const cms = await read('lib/cms.ts');
    expect(cms).toContain("output: './db/schema/cms.ts'");
    expect(cms).toContain("from '@/cms/collections/pages'"); // alias unchanged
  });

  it('honors a non-`@` alias (e.g. `~/*` → ./src/*)', async () => {
    await writeTsconfig(dir, '~/*', './src/*');
    const res = await scaffoldInit({ cwd: dir, preset: PRESETS.pages });

    expect(res.layout).toEqual({ baseDir: 'src', alias: '~', hasAlias: true });
    const cms = await read('src/lib/cms.ts');
    expect(cms).toContain("import { db } from '~/lib/db'");
    expect(cms).toContain("from '~/cms/collections/pages'");
  });

  it('resolves aliases against baseUrl (baseUrl "./src", `@/*` → ["*"])', async () => {
    await writeFile(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { baseUrl: './src', paths: { '@/*': ['*'] } },
      }),
      'utf8',
    );
    expect(await detectProjectLayout(dir)).toEqual({
      baseDir: 'src',
      alias: '@',
      hasAlias: true,
    });
  });

  it('falls back to the src/ directory when no alias is configured', async () => {
    await mkdir(path.join(dir, 'src'), { recursive: true });
    const layout = await detectProjectLayout(dir);
    expect(layout).toEqual({ baseDir: 'src', alias: '@', hasAlias: false });
  });

  it('falls back to the ROOT layout with no tsconfig and no src/', async () => {
    const res = await scaffoldInit({ cwd: dir, preset: PRESETS.pages });
    expect(res.layout).toEqual({ baseDir: '', alias: '@', hasAlias: false });
    expect(res.files.map((f) => f.path)).toContain('lib/cms.ts');
  });
});

describe('createcms init — resolvePreset', () => {
  it('returns the named preset for an explicit --preset', async () => {
    expect((await resolvePreset('blog')).name).toBe('blog');
    expect((await resolvePreset('docs')).name).toBe('docs');
  });

  it('defaults to pages when no preset is given (non-interactive)', async () => {
    // The test env has no TTY → no picker → the default.
    expect((await resolvePreset(undefined)).name).toBe('pages');
  });

  it('throws on an unknown preset, listing the valid names', async () => {
    await expect(resolvePreset('nope')).rejects.toThrow(
      /Unknown preset "nope"/,
    );
    await expect(resolvePreset('nope')).rejects.toThrow(/pages/);
  });

  it('rejects Object.prototype keys as unknown (no prototype-chain bypass)', async () => {
    for (const key of [
      'constructor',
      '__proto__',
      'toString',
      'hasOwnProperty',
    ]) {
      await expect(resolvePreset(key)).rejects.toThrow(/Unknown preset/);
    }
  });
});

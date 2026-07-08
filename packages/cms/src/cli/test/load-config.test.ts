import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCMSConfig } from '../utils/load-config';

// loadCMSConfig aliases @createcms/core subpaths to their real dist entries, so
// the test config must live somewhere @createcms/core is resolvable AND that
// walks up to the repo node_modules (so every other dep is stubbed). The
// `examples/minimal` project has the workspace `@createcms/core` symlink and
// sits inside the repo, so a temp dir under it satisfies both.
const dirname = path.dirname(fileURLToPath(import.meta.url));
const minimalDir = path.resolve(dirname, '../../../../../examples/minimal');

// These assertions load the REAL i18n plugin from dist — skip cleanly on an
// unbuilt checkout rather than reporting a false failure.
let built = false;
try {
  createRequire(path.join(minimalDir, '_')).resolve(
    '@createcms/core/plugins/i18n',
  );
  built = true;
} catch {
  built = false;
}

describe.skipIf(!built)('loadCMSConfig — subpath aliasing & stub hard-fail', () => {
  let dir: string;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(path.join(minimalDir, 'load-config-test-'));
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });

  const writeConfig = (name: string, source: string): string => {
    const p = path.join(dir, name);
    writeFileSync(p, source, 'utf8');
    return p;
  };

  it('loads a plugin from an exports-listed subpath with its real schema (not a stub)', async () => {
    // `@createcms/core/plugins/i18n` is exported in package.json but was ABSENT
    // from the old hard-coded map — the exact silent-data-loss case.
    const configPath = writeConfig(
      'cms.ts',
      `
import { createCMS } from '@createcms/core';
import { i18n } from '@createcms/core/plugins/i18n';

export const cms = createCMS({
  collections: {},
  plugins: [i18n({ languages: ['en', 'de'], defaultLanguage: 'en' })],
});
`,
    );

    const config = await loadCMSConfig(configPath);
    const plugin = (config.$plugins ?? [])[0] as {
      id?: unknown;
      schema?: { extend?: Record<string, unknown> };
      __createcmsStub__?: unknown;
    };

    // Real module, not the inert stub proxy.
    expect(plugin).toBeTruthy();
    expect(plugin.__createcmsStub__).not.toBe(true);
    expect(plugin.id).toBe('i18n');

    // The plugin's schema tables actually appear (would be missing if stubbed).
    const extendKeys = Object.keys(plugin.schema?.extend ?? {});
    expect(extendKeys).toContain('roots');
    expect(extendKeys).toContain('variables');
  });

  it('loads a LOCAL plugin authored with definePlugin/definePluginSchema (shim exposes them)', async () => {
    // The documented local-plugin pattern imports definePlugin/definePluginSchema
    // from '@createcms/core' (the shimmed main entry). Before the shim exported
    // them, this crashed `createcms generate` with "definePluginSchema is not a
    // function" before the schema could be collected.
    const configPath = writeConfig(
      'cms.ts',
      `
import { createCMS, definePlugin, definePluginSchema } from '@createcms/core';

const local = definePlugin({
  id: 'local-widgets',
  schema: definePluginSchema()({
    tables: { widgets: { tableName: 'widgets', columns: { count: { type: 'integer' } } } },
  }),
});

export const cms = createCMS({ collections: {}, plugins: [local] });
`,
    );

    const config = await loadCMSConfig(configPath);
    const plugin = (config.$plugins ?? [])[0] as {
      id?: unknown;
      schema?: { tables?: Record<string, unknown> };
      __createcmsStub__?: unknown;
    };
    expect(plugin).toBeTruthy();
    expect(plugin.__createcmsStub__).not.toBe(true);
    expect(plugin.id).toBe('local-widgets');
    expect(Object.keys(plugin.schema?.tables ?? {})).toContain('widgets');
  });

  it('hard-fails (instead of silently emitting an incomplete schema) when a plugin import cannot be resolved', async () => {
    const configPath = writeConfig(
      'cms.ts',
      `
import { createCMS } from '@createcms/core';
import { missing } from '@createcms/core/plugins/does-not-exist';

export const cms = createCMS({
  collections: {},
  plugins: [missing({})],
});
`,
    );

    await expect(loadCMSConfig(configPath)).rejects.toThrow(
      /SILENTLY MISSING/,
    );
    // The unresolvable specifier is surfaced (normalized back to its @createcms
    // form), not the shim-mangled internal path.
    await expect(loadCMSConfig(configPath)).rejects.toThrow(
      /@createcms\/core\/plugins\/does-not-exist/,
    );
  });
});

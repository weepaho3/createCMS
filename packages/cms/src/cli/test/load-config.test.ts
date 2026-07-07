import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  assertNodeRuntime,
  assertPluginsLoaded,
  deriveCmsSubpathAliases,
} from '../utils/load-config';

const packageJsonPath = fileURLToPath(
  new URL('../../../package.json', import.meta.url),
);

describe('deriveCmsSubpathAliases', () => {
  const pkgRoot = '/pkg';

  it('maps each non-root subpath export to an absolute file (ESM preferred)', () => {
    const aliases = deriveCmsSubpathAliases(pkgRoot, {
      '.': { import: { default: './dist/index.js' } },
      './package.json': './package.json',
      './nanoid': { import: { default: './dist/nanoid.js' } },
      './plugins/i18n': {
        import: { default: './dist/plugins/i18n/index.js' },
        require: { default: './dist/plugins/i18n/index.cjs' },
      },
      './plugins/consent/c15t': './dist/plugins/consent/c15t.js',
    });

    expect(aliases['@createcms/core/plugins/i18n']).toBe(
      path.resolve(pkgRoot, './dist/plugins/i18n/index.js'),
    );
    expect(aliases['@createcms/core/plugins/consent/c15t']).toBe(
      path.resolve(pkgRoot, './dist/plugins/consent/c15t.js'),
    );
    expect(aliases['@createcms/core/nanoid']).toBeDefined();
    // The main entry stays the shim; package.json is not a module.
    expect(aliases['@createcms/core']).toBeUndefined();
    expect(aliases['@createcms/core/package.json']).toBeUndefined();
  });

  // dx-01 regression: a hand-maintained subpath list dropped i18n/consent/etc.
  // to a stub. Deriving from the real exports map must cover EVERY plugin the
  // package actually ships, so it can never drift again.
  it('covers every plugin subpath the package actually ships', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      exports: Record<string, unknown>;
    };
    const pkgRootReal = path.dirname(packageJsonPath);
    const aliases = deriveCmsSubpathAliases(pkgRootReal, pkg.exports);

    const pluginSubpaths = Object.keys(pkg.exports).filter((k) =>
      k.startsWith('./plugins/'),
    );
    expect(pluginSubpaths.length).toBeGreaterThan(5);
    for (const key of pluginSubpaths) {
      const specifier = key.replace(/^\.\//, '');
      expect(
        aliases[`@createcms/core/${specifier}`],
        `no alias derived for ${key}`,
      ).toBeDefined();
    }

    // The exact subpaths dx-01 regressed on.
    expect(aliases['@createcms/core/plugins/i18n']).toBeDefined();
    expect(aliases['@createcms/core/plugins/consent']).toBeDefined();
    expect(aliases['@createcms/core/plugins/ab-test/live']).toBeDefined();
  });
});

describe('assertPluginsLoaded', () => {
  it('accepts real plugin objects with string ids', () => {
    expect(() =>
      assertPluginsLoaded([{ id: 'i18n' }, { id: 'abTest' }]),
    ).not.toThrow();
  });

  it('is a no-op when there are no plugins', () => {
    expect(() => assertPluginsLoaded(undefined)).not.toThrow();
    expect(() => assertPluginsLoaded([])).not.toThrow();
  });

  it('throws when a plugin resolved to the stub proxy (no string id)', () => {
    // Mirrors the loader's STUB_CODE: a Proxy-of-function whose every property
    // (including `id`) is itself the stub.
    const handler: ProxyHandler<() => void> = {
      get: () => stub,
      apply: () => stub,
    };
    const stub: unknown = new Proxy(function () {}, handler);
    expect(() => assertPluginsLoaded([stub])).toThrow(
      /failed to load its real module/,
    );
  });

  it('throws when a plugin id is not a string', () => {
    expect(() => assertPluginsLoaded([{ id: 123 }])).toThrow();
  });
});

describe('assertNodeRuntime', () => {
  it('does not throw under Node.js (the test runtime)', () => {
    expect(() => assertNodeRuntime()).not.toThrow();
  });

  it('throws under Bun (where the module-resolution hook is unavailable)', () => {
    const versions = process.versions as { bun?: string };
    const original = versions.bun;
    versions.bun = '1.1.0';
    try {
      expect(() => assertNodeRuntime()).toThrow(/must run under Node\.js/);
    } finally {
      if (original === undefined) delete versions.bun;
      else versions.bun = original;
    }
  });
});

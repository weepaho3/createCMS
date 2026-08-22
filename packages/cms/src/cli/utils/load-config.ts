import { createJiti } from 'jiti';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import Module from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// A property the stub proxy answers `true` to, letting the loader detect that
// a value (e.g. a `$plugins` entry) is the inert stub rather than a real
// module. Must match STUB_CODE below.
const STUB_MARKER = '__createcmsStub__';

const STUB_CODE = `
const handler = {
  get(_, prop) {
    if (prop === '${STUB_MARKER}') return true;
    if (prop === Symbol.toPrimitive) return () => '';
    if (prop === 'then') return undefined;
    return stub;
  },
  apply() { return stub; },
  construct() { return stub; },
};
const stub = new Proxy(function(){}, handler);
export default stub;
export { stub as auth, stub as db, stub as headers, stub as cookies };
`;

const SHIM_CODE = `
export const createCMS = (definition) => ({
  ...definition,
  router: {},
  api: {},
  collections: definition.collections || {},
  $plugins: definition.plugins || [],
  $schema: definition.schema,
  $notifications: definition.notifications,
});
// Config authoring helpers are pure identity functions at runtime (see
// core/define.ts). The shim re-implements them so a config that imports the
// idiomatic \`defineCollection\` / \`defineCollections\` / \`defineAuthMiddleware\`
// API loads during \`createcms generate\` without pulling in the real package.
export const defineCollection = (collection) => collection;
export const defineCollections = (collections) => collections;
export const defineAuthMiddleware = (middleware) => middleware;
// Same for plugin authoring: without these, a config with a LOCAL plugin (the
// documented pattern) crashes \`createcms generate\` before its schema could be
// collected.
export const definePlugin = (plugin) => plugin;
export const definePluginSchema = () => (schema) => ({ ...schema });
export default { createCMS, defineCollection, defineCollections, defineAuthMiddleware, definePlugin, definePluginSchema };
`;

/**
 * Writes a module file into the (unique, per-invocation) stub directory.
 * Fails hard on any write error: a swallowed failure would leave jiti
 * resolving a stale or attacker-supplied file, or none at all, and silently
 * emit a wrong schema.
 */
function ensureFile(dir: string, name: string, code: string): string {
  const filePath = path.join(dir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, code, 'utf8');
  return filePath;
}

/**
 * True when `value` is the inert stub proxy (see STUB_CODE). Any real module
 * value returns `undefined` for the marker; only the stub answers `true`.
 */
function isStubValue(value: unknown): boolean {
  if (value == null) return false;
  const t = typeof value;
  if (t !== 'object' && t !== 'function') return false;
  try {
    return (value as Record<string, unknown>)[STUB_MARKER] === true;
  } catch {
    return false;
  }
}

function readTsconfigPaths(cwd: string): Record<string, string> {
  const alias: Record<string, string> = {};

  try {
    const raw = readFileSync(path.join(cwd, 'tsconfig.json'), 'utf8');
    const stripped = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
    const tsconfig = JSON.parse(stripped) as {
      compilerOptions?: { paths?: Record<string, string[]>; baseUrl?: string };
    };

    const paths = tsconfig.compilerOptions?.paths;
    const baseUrl = tsconfig.compilerOptions?.baseUrl ?? '.';
    const base = path.resolve(cwd, baseUrl);

    if (paths) {
      for (const [pattern, targets] of Object.entries(paths)) {
        if (targets.length > 0) {
          const key = pattern.replace(/\/\*$/, '');
          const target = targets[0]!.replace(/\/\*$/, '');
          alias[key] = path.resolve(base, target);
        }
      }
    }
  } catch {
    // No tsconfig or invalid tsconfig.
  }

  return alias;
}

/**
 * Scans node_modules directories upward from cwd and collects all installed
 * package names, which are aliased to the stub so jiti never loads them
 * (preventing side effects).
 */
function collectInstalledPackages(cwd: string): string[] {
  const packages = new Set<string>();
  let dir = cwd;

  while (true) {
    const nmDir = path.join(dir, 'node_modules');
    try {
      for (const entry of readdirSync(nmDir)) {
        if (entry.startsWith('.')) continue;
        if (entry.startsWith('@')) {
          const scopeDir = path.join(nmDir, entry);
          try {
            for (const pkg of readdirSync(scopeDir)) {
              if (!pkg.startsWith('.')) packages.add(`${entry}/${pkg}`);
            }
          } catch {
            // not readable
          }
        } else {
          packages.add(entry);
        }
      }
    } catch {
      // no node_modules here
    }

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return [...packages];
}

/**
 * CJS fallback patch: catches any require() that slips through jiti's alias
 * system and redirects it to the stub. Each stubbed request is recorded in
 * `stubbed` so the loader can warn about (and, for plugins, hard-fail on)
 * modules it could not resolve.
 */
function patchModuleResolution(
  stubPath: string,
  stubbed: Set<string>,
): () => void {
  const original = (Module as any)._resolveFilename as (
    request: string,
    parent: unknown,
    isMain: boolean,
    options?: unknown,
  ) => string;

  (Module as any)._resolveFilename = function (
    request: string,
    parent: unknown,
    isMain: boolean,
    options?: unknown,
  ) {
    try {
      return original.call(this, request, parent, isMain, options);
    } catch {
      stubbed.add(request);
      return stubPath;
    }
  };

  return () => {
    (Module as any)._resolveFilename = original;
  };
}

/**
 * Extracts the ESM runtime target from a package.json `exports` entry.
 * Prefers the `import` condition (then `default`), and when that condition is
 * itself an object (nested `types`/`default`), its `default`/`import` leaf.
 */
function resolveExportImportTarget(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    const obj = entry as Record<string, unknown>;
    const preferred = obj.import ?? obj.default;
    if (typeof preferred === 'string') return preferred;
    if (preferred && typeof preferred === 'object') {
      const inner = preferred as Record<string, unknown>;
      if (typeof inner.default === 'string') return inner.default;
      if (typeof inner.import === 'string') return inner.import;
    }
  }
  return null;
}

/**
 * Derives the subpath-alias map from @createcms/core's OWN package.json
 * `exports`, so every exported subpath (e.g. `./plugins/i18n`) is aliased to
 * its resolved dist entry. Jiti treats the base `@createcms/core` alias as a
 * prefix, so without an explicit subpath alias `@createcms/core/plugins/i18n`
 * would resolve under the shim path (which doesn't exist), fall back to the
 * inert stub, and silently drop that plugin's schema tables.
 *
 * Returns specifier -> absolute dist file (e.g.
 * `@createcms/core/plugins/i18n` -> `<pkg>/dist/plugins/i18n/index.js`).
 */
function deriveCmsSubpathAliases(cwd: string): Record<string, string> {
  const alias: Record<string, string> = {};
  try {
    const req = Module.createRequire(path.join(cwd, '_'));
    const pkgJsonPath = req.resolve('@createcms/core/package.json');
    const pkgRoot = path.dirname(pkgJsonPath);
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as {
      exports?: Record<string, unknown>;
    };
    const exportsMap = pkg.exports;
    if (!exportsMap || typeof exportsMap !== 'object') return alias;

    for (const [subpath, entry] of Object.entries(exportsMap)) {
      // '.' is the package root, deliberately served by the lightweight
      // shim; './package.json' is data, not an importable plugin module.
      if (subpath === '.' || subpath === './package.json') continue;
      if (!subpath.startsWith('./')) continue;
      const target = resolveExportImportTarget(entry);
      if (!target) continue;
      const specifier = `@createcms/core/${subpath.slice(2)}`;
      alias[specifier] = path.resolve(pkgRoot, target);
    }
  } catch {
    // @createcms/core not resolvable (e.g. not installed): nothing to derive.
  }
  return alias;
}

export async function loadCMSConfig(configPath: string) {
  const cwd = path.dirname(configPath);
  const tsconfigAlias = readTsconfigPaths(cwd);

  // A UNIQUE, per-invocation temp dir. A fixed shared path
  // (<tmpdir>/createcms-stubs) is guessable and pre-plantable: on a multi-user
  // host an attacker could drop executable stub modules there that jiti then
  // runs in the victim's process on every `createcms generate`. mkdtempSync
  // yields an unpredictable directory we own, removed in `finally`.
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'createcms-'));

  try {
    const stubPath = ensureFile(tmpDir, 'module-stub.mjs', STUB_CODE);
    const shimPath = ensureFile(tmpDir, 'cms-shim.mjs', SHIM_CODE);

    // Stub every installed package, then override @createcms/core with the
    // lightweight shim.
    const allPackages = collectInstalledPackages(cwd);
    const alias: Record<string, string> = {};
    for (const pkg of allPackages) {
      alias[pkg] = stubPath;
    }
    alias['@createcms/core'] = shimPath;

    // Explicit aliases for every exported @createcms/core subpath so the
    // generator loads real plugin schemas instead of the inert stub.
    const cmsSubpathAliases = deriveCmsSubpathAliases(cwd);
    for (const key of Object.keys(alias)) {
      if (key.startsWith('@createcms/core/')) delete alias[key];
    }
    Object.assign(alias, cmsSubpathAliases);

    // tsconfig paths override everything (e.g. @/* -> ./src/*).
    Object.assign(alias, tsconfigAlias);

    const stubbedSpecifiers = new Set<string>();
    const restore = patchModuleResolution(stubPath, stubbedSpecifiers);

    try {
      const jiti = createJiti(pathToFileURL(configPath).href, {
        interopDefault: true,
        moduleCache: false,
        alias,
      });

      const mod = (await jiti.import(configPath)) as Record<string, unknown>;
      // jiti with interopDefault may nest the exports.
      const instance = mod.cms ?? mod.default ?? mod;

      if (!instance || typeof instance !== 'object') {
        throw new Error(
          `No CMS instance found. Export your createCMS() result as default or named "cms" from ${configPath}`,
        );
      }

      const config = instance as {
        $plugins?: Array<{ id: string; schema?: unknown }>;
        $schema?: { output?: string };
        // `notifications: false` drops the notification table + enum from the
        // generated schema (see collectSchemaSources). Default: enabled.
        $notifications?: boolean;
      };

      // jiti applies the base `@createcms/core` -> shim alias as a prefix, so
      // an unresolvable subpath surfaces here as `<shimPath>/plugins/...`.
      // Rewrite it back to the specifier the user actually wrote.
      const friendly = (s: string): string =>
        s.startsWith(`${shimPath}/`)
          ? `@createcms/core/${s.slice(shimPath.length + 1)}`
          : s;
      const stubbedList = [...stubbedSpecifiers].map(friendly);

      // Report every specifier that fell back to the inert stub during load.
      if (stubbedList.length > 0) {
        console.warn(
          `[createcms] ${stubbedList.length} import(s) could not be resolved and were replaced with an inert stub during config load:\n` +
            stubbedList.map((s) => `  - ${s}`).join('\n'),
        );
      }

      // Hard-fail: a plugin that resolved to the stub contributes no real
      // schema, so its tables would be silently missing from the generated
      // schema.
      const stubbedPlugins = (config.$plugins ?? []).filter(isStubValue);
      if (stubbedPlugins.length > 0) {
        throw new Error(
          `${stubbedPlugins.length} plugin(s) in your CMS config resolved to an inert stub instead of a real module. ` +
            `Their schema tables would be SILENTLY MISSING from the generated schema, so generation was aborted. ` +
            (stubbedList.length > 0
              ? `Unresolvable import(s): ${stubbedList.join(', ')}. `
              : '') +
            `Check that the specifier is a real @createcms/core export (see its package.json "exports") and that the package is built.`,
        );
      }

      return config;
    } finally {
      restore();
    }
  } finally {
    // Remove the per-invocation stub dir even when load throws.
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

import { createJiti } from 'jiti';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import Module from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const STUB_CODE = `
const handler = {
  get(_, prop) {
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
export default { createCMS, defineCollection, defineCollections, defineAuthMiddleware };
`;

function ensureFile(dir: string, name: string, code: string): string {
  const filePath = path.join(dir, name);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, code, 'utf8');
  } catch {
    // best-effort
  }
  return filePath;
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
    // No tsconfig or invalid — skip
  }

  return alias;
}

/**
 * Scans node_modules directories upward from cwd and collects all
 * installed package names. These will be aliased to the stub so
 * jiti never loads them (preventing side effects).
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
 * CJS fallback patch: catches any require() that still slips through
 * jiti's alias system and redirects to the stub.
 */
function patchModuleResolution(stubPath: string): () => void {
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
      return stubPath;
    }
  };

  return () => {
    (Module as any)._resolveFilename = original;
  };
}

/**
 * Resolves the real @createcms/core dist directory by locating one of
 * its exported subpaths and walking up to the dist root.
 */
function resolveRealCmsDistDir(cwd: string): string | null {
  try {
    const req = Module.createRequire(path.join(cwd, '_'));
    // Resolve a known export — ./nanoid maps to dist/nanoid.js
    const nanoidPath = req.resolve('@createcms/core/nanoid');
    // nanoidPath = <pkg>/dist/nanoid.js → dirname = <pkg>/dist
    return path.dirname(nanoidPath);
  } catch {
    return null;
  }
}

/**
 * `generate` loads the config by aliasing every installed package to a stub and
 * patching Node's `Module._resolveFilename`. Bun supports neither that CJS
 * resolve hook nor jiti's alias interception the same way, so under Bun EVERY
 * plugin's schema is silently dropped from the output. Fail loudly instead of
 * emitting a wrong schema.
 */
export function assertNodeRuntime(): void {
  const isBun =
    typeof process.versions.bun === 'string' ||
    typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
  if (isBun) {
    throw new Error(
      'createcms generate must run under Node.js, not Bun.\n' +
        "Bun does not support the module-resolution hook the schema loader relies on, " +
        'so plugin schemas would be silently dropped.\n' +
        'Run it with Node instead:  npx createcms generate',
    );
  }
}

/**
 * Reads the runtime file path out of a single package.json `exports` entry,
 * tolerating both the conditional-object shape
 * (`{ import: { default }, require: { default } }`) and the plain-string shape.
 * Prefers ESM.
 */
function resolveExportTarget(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return null;
  const cond = (c: unknown): string | null =>
    typeof c === 'string'
      ? c
      : c && typeof c === 'object'
        ? ((c as { default?: unknown }).default as string) ?? null
        : null;
  const e = entry as Record<string, unknown>;
  return cond(e.import) ?? cond(e.require) ?? cond(e.default) ?? null;
}

/**
 * Derives `@createcms/core/<subpath>` → absolute-dist-file aliases from the
 * package's OWN `exports` map, so every current and future subpath (every
 * bundled plugin included) resolves to the real module during `generate`. This
 * replaces a hand-maintained list that silently dropped any unlisted plugin
 * (e.g. `plugins/i18n`, `plugins/consent`, `plugins/ab-test/live`) to a stub.
 * The main entry (`.`) is intentionally excluded — it stays the lightweight shim.
 */
export function deriveCmsSubpathAliases(
  pkgRoot: string,
  exportsMap: Record<string, unknown>,
): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const [key, entry] of Object.entries(exportsMap)) {
    if (key === '.' || key === './package.json' || key.includes('*')) continue;
    const target = resolveExportTarget(entry);
    if (!target) continue;
    const specifier = key.replace(/^\.\//, '');
    aliases[`@createcms/core/${specifier}`] = path.resolve(pkgRoot, target);
  }
  return aliases;
}

/**
 * A plugin whose real module failed to resolve loads as the opaque stub proxy
 * (a function whose every property is another stub), NOT a plain object with a
 * string `id`. Detect that and abort — otherwise `generate` would emit a schema
 * that silently omits the plugin's tables and enums.
 */
export function assertPluginsLoaded(plugins: unknown): void {
  if (!Array.isArray(plugins)) return;
  plugins.forEach((plugin, index) => {
    if (
      !plugin ||
      typeof plugin !== 'object' ||
      typeof (plugin as { id?: unknown }).id !== 'string'
    ) {
      throw new Error(
        `Plugin at index ${index} failed to load its real module during ` +
          '`createcms generate` (it resolved to a stub, so its schema would be ' +
          'dropped). Ensure the plugin package is installed, that you import it ' +
          'from a valid @createcms/core subpath, and that you run generate under ' +
          'Node.js (not Bun).',
      );
    }
  });
}

export async function loadCMSConfig(configPath: string) {
  assertNodeRuntime();

  const cwd = path.dirname(configPath);
  const tsconfigAlias = readTsconfigPaths(cwd);

  const tmpDir = path.join(tmpdir(), 'createcms-stubs');
  const stubPath = ensureFile(tmpDir, 'module-stub.mjs', STUB_CODE);
  const shimPath = ensureFile(tmpDir, 'cms-shim.mjs', SHIM_CODE);

  // Build alias map: stub every installed package, then override
  // @createcms/core with the lightweight shim
  const allPackages = collectInstalledPackages(cwd);
  const alias: Record<string, string> = {};
  for (const pkg of allPackages) {
    alias[pkg] = stubPath;
  }
  alias['@createcms/core'] = shimPath;

  // Jiti treats aliases as prefix replacements, so @createcms/core/plugins/server
  // would resolve to <shimPath>/plugins/server (which doesn't exist). Every
  // subpath that must load the REAL module (all plugins contribute schema here)
  // needs an explicit alias, derived from the package's own `exports` map so the
  // list can never drift out of sync with what the package ships.
  const cmsDistDir = resolveRealCmsDistDir(cwd);
  if (cmsDistDir) {
    for (const key of Object.keys(alias)) {
      if (key.startsWith('@createcms/core/')) {
        delete alias[key];
      }
    }
    const pkgRoot = path.dirname(cmsDistDir);
    let exportsMap: Record<string, unknown> = {};
    try {
      const pkg = JSON.parse(
        readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'),
      ) as { exports?: Record<string, unknown> };
      exportsMap = pkg.exports ?? {};
    } catch {
      // No/invalid package.json — fall through with no subpath aliases.
    }
    Object.assign(alias, deriveCmsSubpathAliases(pkgRoot, exportsMap));
  }

  // tsconfig paths override everything (e.g. @/* → ./src/*)
  Object.assign(alias, tsconfigAlias);

  const restore = patchModuleResolution(stubPath);

  try {
    const jiti = createJiti(pathToFileURL(configPath).href, {
      interopDefault: true,
      moduleCache: false,
      alias,
    });

    const mod = (await jiti.import(configPath)) as Record<string, unknown>;
    // jiti with interopDefault may nest the exports — try multiple paths
    const instance = mod.cms ?? mod.default ?? mod;

    if (!instance || typeof instance !== 'object') {
      throw new Error(
        `No CMS instance found. Export your createCMS() result as default or named "cms" from ${configPath}`,
      );
    }

    // Fail loudly if any plugin resolved to a stub — otherwise its schema would
    // be silently omitted from the generated output.
    assertPluginsLoaded((instance as { $plugins?: unknown }).$plugins);

    return instance as {
      $plugins?: Array<{ id: string; schema?: unknown }>;
      $schema?: { output?: string };
      // `notifications: false` drops the notification table + enum from the
      // generated schema (see collectSchemaSources). Default: enabled.
      $notifications?: boolean;
    };
  } finally {
    restore();
  }
}

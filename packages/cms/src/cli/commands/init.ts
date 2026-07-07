import type { CAC } from 'cac';

import kleur from 'kleur';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import prompts from 'prompts';

import {
  DEFAULT_PRESET,
  GENERATE_SCRIPT,
  PRESETS,
  type Preset,
  type ProjectLayout,
  buildInitFiles,
} from '../templates/init';
import { fileExists } from '../utils/fs';
import { createSpinner, printMeta } from '../utils/ui';

type FileResult = { path: string; status: 'created' | 'skipped' };
type PkgResult = { status: 'patched' | 'skipped'; reason?: string };

export type ScaffoldResult = {
  files: FileResult[];
  pkg: PkgResult;
  layout: ProjectLayout;
};

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Read tsconfig.json (or jsconfig.json), tolerating `//` and block comments. */
async function readTsConfigLike(cwd: string): Promise<{
  compilerOptions?: { paths?: Record<string, string[]>; baseUrl?: string };
} | null> {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    try {
      const raw = await readFile(path.join(cwd, name), 'utf8');
      const stripped = raw.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
      return JSON.parse(stripped);
    } catch {
      // missing or invalid — try the next candidate
    }
  }
  return null;
}

/**
 * Normalize a tsconfig path target against `baseUrl` to the project-relative
 * root it maps to: `''` for the project root, `'src'` for the src layout, or
 * some other dir (which we don't scaffold into).
 */
function aliasTargetRoot(baseUrl: string, target: string): string {
  const withoutWildcard = target.replace(/\*$/, '');
  const joined = path.posix.normalize(
    path.posix.join(baseUrl.replace(/\\/g, '/'), withoutWildcard),
  );
  const rel = joined.replace(/^\.?\/?/, '').replace(/\/+$/, '');
  return rel === '.' ? '' : rel;
}

/**
 * Detect how the target project is laid out so `init` writes matching paths.
 * Reads the project's tsconfig/jsconfig `paths` to find the import alias (e.g.
 * `@/*`) and whether it maps to the `src/` layout or the project root; falls
 * back to detecting a `src/` directory (default alias `@`) when no alias is
 * configured.
 */
export async function detectProjectLayout(cwd: string): Promise<ProjectLayout> {
  const config = await readTsConfigLike(cwd);
  const paths = config?.compilerOptions?.paths ?? {};
  const baseUrl = config?.compilerOptions?.baseUrl ?? '.';

  // Prefer the conventional `@/*`, then any other wildcard alias that maps to
  // the project root or `src/`.
  const keys = ['@/*', ...Object.keys(paths).filter((k) => k !== '@/*')];
  for (const key of keys) {
    if (!key.endsWith('/*')) continue;
    const target = paths[key]?.[0];
    if (typeof target !== 'string') continue;
    const root = aliasTargetRoot(baseUrl, target);
    if (root === '' || root === 'src') {
      return { baseDir: root, alias: key.slice(0, -2), hasAlias: true };
    }
  }

  // No usable alias — fall back to the presence of a `src/` directory.
  const baseDir = (await isDirectory(path.join(cwd, 'src'))) ? 'src' : '';
  return { baseDir, alias: '@', hasAlias: false };
}

/**
 * Resolve which preset to scaffold. An explicit `--preset` wins (and a typo is
 * a hard error listing the valid names). Otherwise an interactive picker runs
 * when a TTY is available; non-interactively it falls back to the default.
 */
export async function resolvePreset(flag: string | undefined): Promise<Preset> {
  if (flag) {
    // Object.hasOwn (not `in`) so prototype keys (constructor, __proto__, …) are
    // rejected as unknown instead of resolving to a bogus non-preset value.
    if (!Object.hasOwn(PRESETS, flag)) {
      throw new Error(
        `Unknown preset "${flag}". Available: ${Object.keys(PRESETS).join(', ')}.`,
      );
    }
    return PRESETS[flag];
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    const response = await prompts({
      type: 'select',
      name: 'preset',
      message: 'Which collection preset?',
      choices: Object.values(PRESETS).map((p) => ({
        title: p.name,
        description: p.description,
        value: p.name,
      })),
      initial: Object.keys(PRESETS).indexOf(DEFAULT_PRESET),
    });
    // Ctrl+C / escape leaves preset undefined → fall through to the default.
    if (
      typeof response.preset === 'string' &&
      Object.hasOwn(PRESETS, response.preset)
    ) {
      return PRESETS[response.preset];
    }
  }

  return PRESETS[DEFAULT_PRESET];
}

/**
 * Write the scaffold for `preset` into `cwd`. NON-DESTRUCTIVE: an existing file
 * is left untouched and reported as `skipped` (init never clobbers your code).
 * Returns the per-target outcome so the command can report it and tests can
 * assert it. Pure of any console/spinner UI — that lives in the command wrapper.
 */
export async function scaffoldInit(opts: {
  cwd: string;
  preset: Preset;
  /** Override the detected layout (mainly for tests). */
  layout?: ProjectLayout;
}): Promise<ScaffoldResult> {
  const layout = opts.layout ?? (await detectProjectLayout(opts.cwd));
  const files: FileResult[] = [];

  for (const file of buildInitFiles(opts.preset, layout)) {
    const target = path.join(opts.cwd, file.path);
    if (await fileExists(target)) {
      files.push({ path: file.path, status: 'skipped' });
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content(), 'utf8');
    files.push({ path: file.path, status: 'created' });
  }

  return { files, pkg: await patchPackageJson(opts.cwd), layout };
}

/** Add the `cms:generate` script to package.json, if present and not already set. */
async function patchPackageJson(cwd: string): Promise<PkgResult> {
  const pkgPath = path.join(cwd, 'package.json');
  if (!(await fileExists(pkgPath))) {
    return { status: 'skipped', reason: 'no package.json' };
  }

  const raw = await readFile(pkgPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 'skipped', reason: 'package.json is not valid JSON' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'skipped', reason: 'package.json is not an object' };
  }

  const pkg = parsed as { scripts?: Record<string, string> };
  if (pkg.scripts?.[GENERATE_SCRIPT.name]) {
    return {
      status: 'skipped',
      reason: `script "${GENERATE_SCRIPT.name}" exists`,
    };
  }

  pkg.scripts = {
    ...pkg.scripts,
    [GENERATE_SCRIPT.name]: GENERATE_SCRIPT.command,
  };
  // Preserve the file's existing indentation (tabs / N spaces) to avoid
  // reformatting the user's whole package.json into a noisy git diff.
  const indent = raw.match(/\n([ \t]+)\S/)?.[1] ?? '  ';
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, indent)}\n`, 'utf8');
  return { status: 'patched' };
}

export function registerInitCommand(cli: CAC) {
  cli
    .command(
      'init',
      'Scaffold a CMS config, a collection preset, and the Next.js route handler',
    )
    .option('--cwd <dir>', 'Project root to scaffold into (default: cwd)')
    .option(
      '--preset <name>',
      `Collection preset to scaffold (${Object.keys(PRESETS).join(' | ')})`,
    )
    .action(async (options?: { cwd?: string; preset?: string }) => {
      const cwd = path.resolve(process.cwd(), options?.cwd ?? '.');
      const preset = await resolvePreset(options?.preset);

      const spinner = createSpinner(`Scaffolding the "${preset.name}" preset`);
      spinner.start();
      let result: ScaffoldResult;
      try {
        result = await scaffoldInit({ cwd, preset });
      } catch (error) {
        spinner.fail('  Scaffolding failed');
        throw error;
      }
      const created = result.files.filter((f) => f.status === 'created').length;
      spinner.succeed(
        `  Scaffolded ${created} file${created === 1 ? '' : 's'}`,
      );

      console.log();
      for (const f of result.files) {
        const tag =
          f.status === 'created'
            ? kleur.green('created')
            : kleur.yellow('exists ');
        printMeta(tag, kleur.dim(f.path));
      }
      const pkgTag =
        result.pkg.status === 'patched'
          ? kleur.green('script ')
          : kleur.yellow('skipped');
      printMeta(
        pkgTag,
        kleur.dim(
          result.pkg.status === 'patched'
            ? `package.json → ${GENERATE_SCRIPT.name}`
            : `package.json (${result.pkg.reason})`,
        ),
      );

      // No `@/*`-style alias in tsconfig: the scaffolded imports won't resolve
      // until one is configured. Warn (the scaffold still lands in the right
      // layout, using the default `@` prefix).
      if (!result.layout.hasAlias) {
        console.log();
        printMeta(
          kleur.yellow('warn   '),
          kleur.dim(
            `No import alias found in tsconfig — the scaffolded "${result.layout.alias}/*" ` +
              `imports need a path alias (e.g. "${result.layout.alias}/*": ["./${result.layout.baseDir ? 'src/*' : '*'}"]).`,
          ),
        );
      }

      const { baseDir, alias } = result.layout;
      const dbPath = baseDir ? `${baseDir}/lib/db.ts` : 'lib/db.ts';

      console.log();
      console.log(`  ${kleur.bold('Next steps')}`);
      printMeta(
        '1.',
        `Provide your Drizzle client at ${dbPath} (${alias}/lib/db).`,
      );
      printMeta('2.', 'Set DATABASE_URL + the S3_* vars (see .env.example).');
      printMeta(
        '3.',
        `Run "${GENERATE_SCRIPT.command}" to emit the Drizzle schema.`,
      );
      printMeta(
        '4.',
        'Generate + run your migrations (drizzle-kit), then start the app.',
      );
      console.log();
    });
}

import type { CAC } from 'cac';

import kleur from 'kleur';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import prompts from 'prompts';

import {
  DEFAULT_PRESET,
  GENERATE_SCRIPT,
  PRESETS,
  buildInitFiles,
  type Preset,
} from '../templates/init';
import { fileExists } from '../utils/fs';
import { createSpinner, printMeta } from '../utils/ui';

type FileResult = { path: string; status: 'created' | 'skipped' };
type PkgResult = { status: 'patched' | 'skipped'; reason?: string };

export type ScaffoldResult = { files: FileResult[]; pkg: PkgResult };

/**
 * Resolve which preset to scaffold. An explicit `--preset` wins (and a typo is
 * a hard error listing the valid names). Otherwise an interactive picker runs
 * when a TTY is available; non-interactively it falls back to the default.
 */
export async function resolvePreset(flag: string | undefined): Promise<Preset> {
  if (flag) {
    // Object.hasOwn (not `in`) so prototype keys (constructor, __proto__, ...)
    // are rejected as unknown instead of resolving to a non-preset value.
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
 * Write the scaffold for `preset` into `cwd`, non-destructively: an existing
 * file is left untouched and reported as `skipped`. Pure of any console or
 * spinner UI; that lives in the command wrapper.
 */
export async function scaffoldInit(opts: {
  cwd: string;
  preset: Preset;
}): Promise<ScaffoldResult> {
  const files: FileResult[] = [];

  for (const file of buildInitFiles(opts.preset)) {
    const target = path.join(opts.cwd, file.path);
    if (await fileExists(target)) {
      files.push({ path: file.path, status: 'skipped' });
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content(), 'utf8');
    files.push({ path: file.path, status: 'created' });
  }

  return { files, pkg: await patchPackageJson(opts.cwd) };
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

      console.log();
      console.log(`  ${kleur.bold('Next steps')}`);
      printMeta(
        '1.',
        'Provide your Drizzle client at src/lib/db.ts (@/lib/db).',
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

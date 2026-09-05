import type { CAC } from 'cac';

import kleur from 'kleur';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { SchemaSource } from '../../core/db/merge';

import { generateSchema, renderSchema } from '../../core/codegen/generate';
import { coreSchema } from '../../core/db/core-schema';
import { discoverConfig } from '../utils/discover-config';
import { fileExists } from '../utils/fs';
import { loadCMSConfig } from '../utils/load-config';
import { confirmOverwrite, createSpinner, printMeta } from '../utils/ui';

/**
 * The core schema, minus the notifications table and its enum when
 * notifications are disabled (`notifications: false`): `notificationType` is
 * referenced only by the `notifications` table, so both drop together. When
 * enabled, `extraNotificationTypes` (plugin-contributed `notificationTypes`
 * keys) are folded into the `notification_type` enum.
 */
export function coreSchemaFor(
  notificationsEnabled: boolean,
  extraNotificationTypes: string[] = [],
): SchemaSource['schema'] {
  if (!notificationsEnabled) {
    const tables = { ...coreSchema.tables };
    delete (tables as Record<string, unknown>).notifications;
    const enums = { ...coreSchema.enums };
    delete (enums as Record<string, unknown>).notificationType;
    return { ...coreSchema, tables, enums } as SchemaSource['schema'];
  }
  if (extraNotificationTypes.length === 0) {
    return coreSchema as SchemaSource['schema'];
  }
  const notificationType = (
    coreSchema.enums as Record<string, { enumName: string; values: string[] }>
  ).notificationType;
  const enums = {
    ...coreSchema.enums,
    notificationType: {
      ...notificationType,
      values: [
        ...new Set([...notificationType.values, ...extraNotificationTypes]),
      ],
    },
  };
  return { ...coreSchema, enums } as SchemaSource['schema'];
}

function collectSchemaSources(
  config: Awaited<ReturnType<typeof loadCMSConfig>>,
): SchemaSource[] {
  // Plugin-contributed notification types fold into the core notification_type
  // enum so a plugin can persist its own `type`.
  const extraNotificationTypes = (config.$plugins ?? []).flatMap((plugin) =>
    Object.keys(
      (plugin as { notificationTypes?: Record<string, unknown> })
        .notificationTypes ?? {},
    ),
  );

  const sources: SchemaSource[] = [
    {
      name: 'core',
      schema: coreSchemaFor(
        config.$notifications !== false,
        extraNotificationTypes,
      ),
    },
  ];

  if (config.$plugins) {
    for (const plugin of config.$plugins) {
      if (plugin.schema) {
        sources.push({
          name: `plugin:${plugin.id}`,
          schema: plugin.schema as SchemaSource['schema'],
        });
      }
    }
  }

  return sources;
}

export type GenerateCheckResult =
  | { status: 'match'; expected: string }
  | { status: 'drift'; expected: string; actual: string; diff: string }
  | { status: 'missing'; expected: string; outputPath: string };

/** Compact, dependency-free diff hint: first differing line + a little context. */
function shortDiff(expected: string, actual: string): string {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const maxLines = Math.max(expectedLines.length, actualLines.length);

  let firstDiff = -1;
  let differingCount = 0;
  for (let i = 0; i < maxLines; i++) {
    if (expectedLines[i] !== actualLines[i]) {
      if (firstDiff === -1) firstDiff = i;
      differingCount++;
    }
  }

  if (firstDiff === -1) return '';

  const expectedLine =
    expectedLines[firstDiff] ?? '(nothing — file has fewer lines)';
  const actualLine =
    actualLines[firstDiff] ?? '(nothing — file has fewer lines)';

  return [
    `schema drift at line ${firstDiff + 1}:`,
    `  expected: ${expectedLine}`,
    `  on disk:  ${actualLine}`,
    `(${differingCount} of ${maxLines} lines differ)`,
  ].join('\n');
}

/**
 * Re-render the schema from `sources` and compare it against what is on disk
 * at `outputPath`, without writing anything.
 */
export async function runGenerateCheck(args: {
  sources: SchemaSource[];
  outputPath: string;
}): Promise<GenerateCheckResult> {
  const { output: expected } = renderSchema({ sources: args.sources });

  let actual: string;
  try {
    actual = await readFile(args.outputPath, 'utf8');
  } catch {
    return { status: 'missing', expected, outputPath: args.outputPath };
  }

  if (actual === expected) return { status: 'match', expected };

  return {
    status: 'drift',
    expected,
    actual,
    diff: shortDiff(expected, actual),
  };
}

export function registerGenerateCommand(cli: CAC) {
  cli
    .command(
      'generate [config]',
      'Generate the Drizzle schema from your CMS config',
    )
    .option('--output <path>', 'Override the output file path')
    .option(
      '--force, --yes',
      'Overwrite an existing schema without prompting (required in CI/non-interactive shells)',
    )
    .option(
      '--check',
      'Verify the generated schema is up to date without writing; exit non-zero on drift (for CI)',
    )
    .action(
      async (
        configArg?: string,
        options?: {
          output?: string;
          force?: boolean;
          yes?: boolean;
          check?: boolean;
        },
      ) => {
        const cwd = process.cwd();

        const spinner = createSpinner('Looking for config');
        spinner.start();

        let configPath: string;

        if (configArg) {
          configPath = path.resolve(cwd, configArg);
        } else {
          const discovered = await discoverConfig(cwd);
          if (!discovered) {
            spinner.fail(
              'No cms.ts found. Searched cms.ts, src/cms.ts, src/lib/cms.ts. Pass a path: createcms generate ./path/to/cms.ts',
            );
            process.exit(1);
          }
          configPath = discovered;
        }

        spinner.succeed(`  Found: ${configPath}`);

        const loadSpinner = createSpinner('Loading CMS config');
        loadSpinner.start();
        let config: Awaited<ReturnType<typeof loadCMSConfig>>;
        try {
          config = await loadCMSConfig(configPath);
        } catch (err) {
          loadSpinner.fail('  Failed to load CMS config');
          throw err;
        }
        loadSpinner.succeed('  Config loaded');

        const outputPath = path.resolve(
          cwd,
          options?.output ?? config.$schema?.output ?? './cms-schema.ts',
        );

        console.log();
        printMeta('config', kleur.dim(configPath));
        printMeta('output', kleur.dim(outputPath));

        const sources = collectSchemaSources(config);
        const pluginCount = sources.length - 1;
        if (pluginCount > 0) {
          printMeta(
            'plugins',
            kleur.dim(
              sources
                .filter((s) => s.name !== 'core')
                .map((s) => s.name.replace('plugin:', ''))
                .join(', '),
            ),
          );
        }

        if (options?.check) {
          const result = await runGenerateCheck({ sources, outputPath });
          if (result.status === 'match') {
            console.log(`\n  ${kleur.green('✓')} Schema is up to date.`);
            return;
          }
          if (result.status === 'missing') {
            console.error(
              `\n  ${kleur.red('Error:')} No generated schema at ${outputPath}. Run \`createcms generate\`.`,
            );
            process.exit(1);
          }
          console.error(
            `\n  ${kleur.red('Error:')} Generated schema is out of date.`,
          );
          console.error(result.diff);
          console.error(
            `\n  Run \`createcms generate\` and commit the result.`,
          );
          process.exit(1);
        }

        const forced = options?.force === true || options?.yes === true;

        if (!forced && (await fileExists(outputPath))) {
          const interactive = process.stdin.isTTY && process.stdout.isTTY;

          if (!interactive) {
            // Non-interactive (CI): fail loudly instead of leaving a stale
            // schema in place with a success exit code.
            console.error(
              `\n  ${kleur.red('Error:')} Output file already exists and no interactive terminal is available.`,
            );
            printMeta('file', outputPath);
            printMeta(
              'hint',
              'Pass --force (alias --yes) to overwrite it in CI.',
            );
            process.exit(1);
          }

          const shouldOverwrite = await confirmOverwrite(outputPath);
          if (!shouldOverwrite) {
            console.log(`\n  ${kleur.yellow('Generation cancelled.')}`);
            return;
          }
        }

        const genSpinner = createSpinner('Generating schema');
        genSpinner.start();

        try {
          const result = await generateSchema({
            sources,
            outputPath,
          });

          genSpinner.succeed('  Schema generated');

          console.log();
          printMeta('file', kleur.green(result.outputPath));
          printMeta(
            'tables',
            kleur.green(String(Object.keys(result.schema.tables).length)),
          );
          printMeta(
            'enums',
            kleur.green(String(Object.keys(result.schema.enums).length)),
          );
          console.log();
        } catch (error) {
          genSpinner.fail('  Schema generation failed');
          throw error;
        }
      },
    );
}

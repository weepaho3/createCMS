import type { CAC } from 'cac';

import kleur from 'kleur';
import path from 'node:path';

import type { SchemaSource } from '../../core/db/merge';

import { generateSchema } from '../../core/codegen/generate';
import { coreSchema } from '../../core/db/core-schema';
import { discoverConfig } from '../utils/discover-config';
import { fileExists } from '../utils/fs';
import { loadCMSConfig } from '../utils/load-config';
import { confirmOverwrite, createSpinner, printMeta } from '../utils/ui';

function collectSchemaSources(
  config: Awaited<ReturnType<typeof loadCMSConfig>>,
): SchemaSource[] {
  const sources: SchemaSource[] = [{ name: 'core', schema: coreSchema }];

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

export function registerGenerateCommand(cli: CAC) {
  cli
    .command(
      'generate [config]',
      'Generate the Drizzle schema from your CMS config',
    )
    .option('--output <path>', 'Override the output file path')
    .action(async (configArg?: string, options?: { output?: string }) => {
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

      if (await fileExists(outputPath)) {
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
    });
}

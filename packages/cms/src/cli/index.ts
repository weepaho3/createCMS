#!/usr/bin/env node

import { cac } from 'cac';
import { createRequire } from 'node:module';

import { registerGenerateCommand } from './commands/generate';
import { registerInitCommand } from './commands/init';

// Read the real version from the package manifest instead of hardcoding it, so
// `createcms --version` always matches the installed package. The built bin
// lives at `dist/bin/`, so the manifest is two levels up. Guarded so an
// unexpected layout only degrades `--version`, never crashes the whole CLI.
function readPackageVersion(): string {
  try {
    return (
      createRequire(import.meta.url)('../../package.json') as {
        version: string;
      }
    ).version;
  } catch {
    return '0.0.0';
  }
}

const cli = cac('createcms');

registerInitCommand(cli);
registerGenerateCommand(cli);

cli.help();
cli.version(readPackageVersion());
cli.parse(process.argv, { run: false });

const result = cli.runMatchedCommand();
if (result && typeof result === 'object' && 'then' in result) {
  (result as Promise<unknown>).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

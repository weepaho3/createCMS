#!/usr/bin/env node

import { cac } from 'cac';

import { version } from '../../package.json';
import { registerGenerateCommand } from './commands/generate';
import { registerInitCommand } from './commands/init';

const cli = cac('createcms');

registerInitCommand(cli);
registerGenerateCommand(cli);

cli.help();
// Inlined at build time from package.json (bunchee -> @rollup/plugin-json), so
// `createcms --version` always matches the published version.
cli.version(version);
cli.parse(process.argv, { run: false });

const result = cli.runMatchedCommand();
if (result && typeof result === 'object' && 'then' in result) {
  (result as Promise<unknown>).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

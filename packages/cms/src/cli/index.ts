#!/usr/bin/env node

import { cac } from 'cac';

import { registerGenerateCommand } from './commands/generate';
import { registerInitCommand } from './commands/init';

const cli = cac('createcms');

registerInitCommand(cli);
registerGenerateCommand(cli);

cli.help();
cli.version('0.0.1');
cli.parse(process.argv, { run: false });

const result = cli.runMatchedCommand();
if (result && typeof result === 'object' && 'then' in result) {
  (result as Promise<unknown>).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

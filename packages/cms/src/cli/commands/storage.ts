import type { CAC } from 'cac';

import kleur from 'kleur';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { MediaConfig } from '../../core/types/s3';

import { getStorage } from '../../core/storage/get-storage';
import { createS3Client } from '../../core/storage/s3/client';
import { discoverConfig } from '../utils/discover-config';
import { loadCMSConfig } from '../utils/load-config';
import { type CheckResult, runStorageCheck } from '../utils/storage-check';
import { createSpinner } from '../utils/ui';

/**
 * True when the `media` block holds real values rather than load-time
 * stubs: `bucketName` and `publicUrl` are non-empty strings.
 */
function isMediaConfig(value: unknown): value is MediaConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'bucketName' in value &&
    'publicUrl' in value &&
    typeof value.bucketName === 'string' &&
    value.bucketName !== '' &&
    typeof value.publicUrl === 'string' &&
    value.publicUrl !== ''
  );
}

const SYMBOL: Record<CheckResult['status'], string> = {
  pass: kleur.green('✓'),
  fail: kleur.red('✗'),
  skip: kleur.dim('-'),
};

export function formatCheckResults(results: CheckResult[]): string {
  return results
    .map((r) => {
      const lines = [
        `${SYMBOL[r.status]} ${kleur.bold(r.name)}`,
        `  ${r.detail}`,
      ];
      if (r.status === 'fail' && r.fix) {
        lines.push(
          `  ${kleur.yellow('Fix:')}`,
          ...r.fix.split('\n').map((line) => `    ${line}`),
        );
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

export function registerStorageCommand(cli: CAC) {
  cli
    .command(
      'storage <action> [config]',
      'Check the media storage setup (action: check)',
    )
    .option(
      '--origin <url>',
      'Admin origin that uploads from the browser, for the CORS check',
    )
    .action(
      async (
        action: string,
        configArg?: string,
        options?: { origin?: string },
      ) => {
        if (action !== 'check') {
          console.error(
            `Unknown storage action "${action}". Use: createcms storage check`,
          );
          process.exit(1);
        }
        const cwd = process.cwd();
        const spinner = createSpinner('Loading config');
        spinner.start();

        const configPath = configArg
          ? path.resolve(cwd, configArg)
          : await discoverConfig(cwd);
        if (!configPath) {
          spinner.fail(
            'No cms.ts found. Searched cms.ts, src/cms.ts, src/lib/cms.ts. Pass a path: createcms storage check ./path/to/cms.ts',
          );
          process.exit(1);
        }

        const { media } = await loadCMSConfig(configPath);
        if (!isMediaConfig(media)) {
          spinner.fail(
            'The media config could not be read with real values. Make sure bucketName, publicUrl and the credentials come from process.env when the config loads.',
          );
          process.exit(1);
        }

        spinner.text = 'Checking storage';
        const storage = getStorage(media);
        const client = media.storage ? null : createS3Client(media);
        const results = await runStorageCheck({
          config: media,
          storage,
          s3: client
            ? {
                bucketUrl: client.buildBucketUrl(media.bucketName),
                fetch: (url, init) => client.s3.fetch(url, init),
              }
            : undefined,
          fetch: (url, init) => fetch(url, init),
          origin: options?.origin,
          randomId: () => randomUUID().slice(0, 8),
        });
        spinner.stop();

        console.log(formatCheckResults(results));
        if (results.some((r) => r.status === 'fail')) process.exit(1);
      },
    );
}

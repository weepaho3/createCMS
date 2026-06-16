import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { emitDrizzleSchema, type EmitOptions } from '../db/emit';
import { mergeSchemaSources, type SchemaSource } from '../db/merge';

export type GeneratorConfig = {
  sources: SchemaSource[];
  outputPath: string;
  emit?: EmitOptions;
};

export async function generateSchema(config: GeneratorConfig) {
  const merged = mergeSchemaSources(config.sources);
  const output = emitDrizzleSchema(merged, config.emit);
  const outputPath = path.resolve(config.outputPath);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, 'utf8');

  return {
    outputPath,
    schema: merged,
    output,
  };
}

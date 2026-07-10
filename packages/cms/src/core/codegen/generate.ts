import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { emitDrizzleSchema, type EmitOptions } from '../db/emit';
import { mergeSchemaSources, type SchemaSource } from '../db/merge';

export type GeneratorConfig = {
  sources: SchemaSource[];
  outputPath: string;
  emit?: EmitOptions;
};

export type RenderedSchema = {
  schema: ReturnType<typeof mergeSchemaSources>;
  output: string;
};

/** Merge + emit the schema string. Pure — no filesystem writes. */
export function renderSchema(
  config: Pick<GeneratorConfig, 'sources' | 'emit'>,
): RenderedSchema {
  const schema = mergeSchemaSources(config.sources);
  const output = emitDrizzleSchema(schema, config.emit);
  return { schema, output };
}

export async function generateSchema(config: GeneratorConfig) {
  const { schema, output } = renderSchema(config);
  const outputPath = path.resolve(config.outputPath);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, 'utf8');

  return {
    outputPath,
    schema,
    output,
  };
}

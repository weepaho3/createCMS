import { and, asc, eq, gt, inArray } from 'drizzle-orm';

import type {
  HtmlToRichTextOptions,
  RichTextLossReport,
} from '../rich-text/parse-html';
import type { RichTextSchema } from '../rich-text/types';
import type { BlockProperty, CollectionWithName } from '../types/definitions';
import type { DrizzleInstance } from '../types/drizzle';

import { blockVersions, roots } from '../db/schema.generated';
import { htmlToRichText, isLossless } from '../rich-text/parse-html';
import { isRichTextDoc, richTextSchemaOf } from '../rich-text/schema';

export type MigrateRichTextOptions = {
  /** Converts nothing; the report says what a run would do. */
  dryRun?: boolean;
  /** Only roots of this collection. */
  collection?: string;
  /** Block versions per transaction. Default 500. */
  batchSize?: number;
  /** Continue after this block version id (the previous run's `nextCursor`). */
  cursor?: string | null;
  /** Stop after this many batches and return a `nextCursor`. Default: no limit. */
  maxBatches?: number;
  /** Parses HTML on the server (e.g. a happy-dom or linkedom document). */
  domParser: NonNullable<HtmlToRichTextOptions['domParser']>;
  /** After each batch. */
  onProgress?: (progress: { scanned: number; cursor: string }) => void;
};

/** Where one converted or failed value sits. */
export type RichTextMigrationEntry = {
  blockVersionId: string;
  rootId: string;
  blockId: string;
  /** The property key, with the list index for a list of `richText`. */
  property: string;
};

export type RichTextMigrationReport = {
  dryRun: boolean;
  /** Block versions read. */
  scanned: number;
  /** `richText` values found (list elements count one each). */
  values: number;
  /** Values that were HTML strings and are now (or would be) JSON. */
  converted: number;
  /** Values already stored as JSON or empty. */
  skipped: number;
  /** Converted values that dropped markup, with what was dropped. */
  lossy: (RichTextMigrationEntry & { loss: RichTextLossReport })[];
  /** Values neither JSON nor a string; left unchanged. */
  failed: (RichTextMigrationEntry & { error: string })[];
  /** Pass to the next run to continue; `null` when every version was read. */
  nextCursor: string | null;
};

type Paths = Map<
  string,
  { key: string; list: boolean; schema: RichTextSchema }[]
>;

/** The `richText` properties per block type of one collection. */
function richTextPaths(def: CollectionWithName): Paths {
  const paths: Paths = new Map();
  const add = (
    type: string,
    properties: Readonly<Record<string, BlockProperty>>,
  ) => {
    const found: { key: string; list: boolean; schema: RichTextSchema }[] = [];
    for (const [key, spec] of Object.entries(properties)) {
      if (spec.type === 'richText') {
        found.push({ key, list: false, schema: richTextSchemaOf(spec) });
      } else if (spec.type === 'list' && spec.of.type === 'richText') {
        found.push({ key, list: true, schema: richTextSchemaOf(spec.of) });
      }
    }
    if (found.length > 0) paths.set(type, found);
  };
  add(def.name, def.root.properties);
  for (const [type, block] of Object.entries(def.blocks ?? {})) {
    add(type, block.properties);
  }
  return paths;
}

/**
 * Converts stored HTML `richText` values of every block version (history
 * included) to JSON with `htmlToRichText` and each property's allowed
 * formatting. Values already in JSON are skipped, so a second run changes
 * nothing; values that are neither JSON nor a string stay and are reported.
 * Each batch runs in one transaction; `maxBatches` with `cursor` splits a
 * large migration into resumable runs. Rebuild the search index afterwards
 * (`admin.reindexSearch`).
 */
export async function migrateRichText(
  db: DrizzleInstance,
  collections: Readonly<Record<string, CollectionWithName>>,
  options: MigrateRichTextOptions,
): Promise<RichTextMigrationReport> {
  const dryRun = options.dryRun === true;
  const batchSize = Math.max(1, options.batchSize ?? 500);
  const report: RichTextMigrationReport = {
    dryRun,
    scanned: 0,
    values: 0,
    converted: 0,
    skipped: 0,
    lossy: [],
    failed: [],
    nextCursor: null,
  };
  const pathsByCollection = new Map<string, Paths>();
  for (const [name, def] of Object.entries(collections)) {
    if (options.collection && options.collection !== name) continue;
    const paths = richTextPaths(def);
    if (paths.size > 0) pathsByCollection.set(name, paths);
  }
  if (pathsByCollection.size === 0) return report;

  let cursor = options.cursor ?? null;
  let batches = 0;
  for (;;) {
    if (options.maxBatches !== undefined && batches >= options.maxBatches) {
      report.nextCursor = cursor;
      return report;
    }
    const rows = await db
      .select({
        id: blockVersions.id,
        rootId: blockVersions.rootId,
        blockId: blockVersions.blockId,
        type: blockVersions.type,
        properties: blockVersions.properties,
        collection: roots.collection,
      })
      .from(blockVersions)
      .innerJoin(roots, eq(roots.id, blockVersions.rootId))
      .where(
        and(
          cursor ? gt(blockVersions.id, cursor) : undefined,
          inArray(roots.collection, [...pathsByCollection.keys()]),
        ),
      )
      .orderBy(asc(blockVersions.id))
      .limit(batchSize);
    if (rows.length === 0) return report;
    batches += 1;

    const updates: { id: string; properties: Record<string, unknown> }[] = [];
    for (const row of rows) {
      report.scanned += 1;
      const paths = pathsByCollection.get(row.collection)?.get(row.type);
      if (!paths) continue;
      let next: Record<string, unknown> | null = null;
      const convert = (
        value: unknown,
        property: string,
        schema: RichTextSchema,
      ) => {
        report.values += 1;
        if (isRichTextDoc(value) || value === null || value === undefined) {
          report.skipped += 1;
          return value;
        }
        const entry = {
          blockVersionId: row.id,
          rootId: row.rootId,
          blockId: row.blockId,
          property,
        };
        if (typeof value !== 'string') {
          report.failed.push({ ...entry, error: 'not a string or rich text' });
          return value;
        }
        try {
          const { doc, lossy } = htmlToRichText(value, schema, {
            domParser: options.domParser,
          });
          report.converted += 1;
          if (!isLossless(lossy)) report.lossy.push({ ...entry, loss: lossy });
          return doc;
        } catch (error) {
          report.failed.push({
            ...entry,
            error: error instanceof Error ? error.message : String(error),
          });
          return value;
        }
      };
      for (const { key, list, schema } of paths) {
        if (!(key in row.properties)) continue;
        const value = row.properties[key];
        let out: unknown;
        if (list && Array.isArray(value)) {
          const items = value.map((item: unknown, i) =>
            convert(item, `${key}[${i}]`, schema),
          );
          out = items.some((item, i) => item !== value[i]) ? items : value;
        } else {
          out = convert(value, key, schema);
        }
        if (out !== value) {
          next ??= { ...row.properties };
          next[key] = out;
        }
      }
      if (next) updates.push({ id: row.id, properties: next });
    }

    if (!dryRun && updates.length > 0) {
      await db.transaction(async (tx) => {
        for (const update of updates) {
          await tx
            .update(blockVersions)
            .set({ properties: update.properties })
            .where(eq(blockVersions.id, update.id));
        }
      });
    }
    cursor = rows.at(-1)!.id;
    options.onProgress?.({ scanned: report.scanned, cursor });
    if (rows.length < batchSize) return report;
  }
}

/** A Markdown summary of a migration report. */
export function formatRichTextMigrationReport(
  report: RichTextMigrationReport,
): string {
  const lines = [
    `# Rich text migration${report.dryRun ? ' (dry run)' : ''}`,
    '',
    `- Block versions read: ${report.scanned}`,
    `- richText values: ${report.values}`,
    `- Converted from HTML: ${report.converted}`,
    `- Already JSON or empty: ${report.skipped}`,
    `- Lossy conversions: ${report.lossy.length}`,
    `- Failed: ${report.failed.length}`,
  ];
  if (report.nextCursor) {
    lines.push(`- Not finished; continue with cursor \`${report.nextCursor}\``);
  }
  if (report.lossy.length > 0) {
    lines.push('', '## Lossy conversions', '');
    for (const entry of report.lossy) {
      const dropped = [
        ...Object.entries(entry.loss.tags).map(([k, n]) => `<${k}> x${n}`),
        ...Object.entries(entry.loss.attributes).map(([k, n]) => `${k} x${n}`),
        ...Object.entries(entry.loss.nodes).map(([k, n]) => `node ${k} x${n}`),
        ...Object.entries(entry.loss.marks).map(([k, n]) => `mark ${k} x${n}`),
      ].join(', ');
      lines.push(
        `- ${entry.blockVersionId} (root ${entry.rootId}, block ${entry.blockId}, ${entry.property}): ${dropped}`,
      );
    }
  }
  if (report.failed.length > 0) {
    lines.push('', '## Failed', '');
    for (const entry of report.failed) {
      lines.push(
        `- ${entry.blockVersionId} (root ${entry.rootId}, block ${entry.blockId}, ${entry.property}): ${entry.error}`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

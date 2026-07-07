// ============================================================================
// `createcms init` scaffold templates + collection presets
// ============================================================================
//
// Plain string templates (bundled into dist by bunchee — NOT read from disk at
// runtime). They target a Next.js App Router project. The file paths and the
// import-alias prefix are NOT hardcoded: `detectProjectLayout` reads the
// project's tsconfig/jsconfig to decide the `src/`-vs-root layout and the `@/*`
// (or other) path alias, and the templates below are parameterized by that
// `ProjectLayout` so the scaffold matches the project. db wiring is left to the
// consumer (`<alias>/lib/db`) — `init` only scaffolds the CMS side.

/**
 * How the target project is laid out, so the scaffold writes matching paths.
 */
export type ProjectLayout = {
  /** `'src'` for the create-next-app `--src-dir` layout, `''` for root layout. */
  baseDir: string;
  /** Import-alias prefix WITHOUT the trailing `/*` (e.g. `'@'`, `'~'`). */
  alias: string;
  /** Whether a matching wildcard path alias was actually found in the tsconfig.
   *  When false the scaffold falls back to `'@'` and the caller warns. */
  hasAlias: boolean;
};

/** Prefix a project-relative path with the layout's base dir (`src/` or none). */
function inBase(layout: ProjectLayout, rel: string): string {
  return layout.baseDir ? `${layout.baseDir}/${rel}` : rel;
}

/**
 * A ready-made collection the consumer can scaffold via `createcms init
 * --preset <name>`. The scaffolded collection file is editable code the
 * consumer OWNS (presets are a starting point, not a maintained import).
 */
export type Preset = {
  /** `--preset <name>` + the interactive-picker key. */
  name: string;
  /** One-line description shown in the picker. */
  description: string;
  /** Collection file basename: `src/cms/collections/<fileName>.ts`. */
  fileName: string;
  /** The exported const in that file (e.g. `pagesCollection`). */
  exportName: string;
  /** The `collections` key in cms.ts = the API namespace (`cms.api.<key>`). */
  collectionKey: string;
  /** The collection file's contents. */
  collection: () => string;
};

const pagesCollection =
  (): string => `import type { CollectionDefinition } from '@createcms/core';

export const pagesCollection = {
  label: 'Pages',
  description: 'Marketing and content pages.',
  slug: { enabled: true, root: '/' },
  root: {
    properties: {
      title: {
        type: 'string',
        label: 'Title',
        required: true,
        defaultValue: 'Untitled page',
      },
    },
  },
  blocks: {
    richText: {
      label: 'Rich Text',
      description: 'A block of formatted text.',
      properties: {
        content: { type: 'richText', label: 'Content', required: true },
      },
    },
  },
} as const satisfies CollectionDefinition;

export type PagesCollection = typeof pagesCollection;
`;

const postsCollection =
  (): string => `import type { CollectionDefinition } from '@createcms/core';

export const postsCollection = {
  label: 'Blog Posts',
  description: 'Articles and updates.',
  slug: { enabled: true, root: '/blog' },
  root: {
    properties: {
      title: {
        type: 'string',
        label: 'Title',
        required: true,
        defaultValue: 'Untitled post',
      },
      excerpt: {
        type: 'string',
        label: 'Excerpt',
        placeholder: 'A short summary shown in listings.',
      },
      publishedAt: { type: 'date', label: 'Published at' },
      draft: { type: 'boolean', label: 'Draft', defaultValue: false },
    },
  },
  blocks: {
    richText: {
      label: 'Rich Text',
      description: 'A block of formatted text.',
      properties: {
        content: { type: 'richText', label: 'Content', required: true },
      },
    },
    image: {
      label: 'Image',
      description: 'A figure with optional caption.',
      properties: {
        src: { type: 'image', label: 'Image', required: true },
        alt: { type: 'string', label: 'Alt text', required: true },
        caption: { type: 'string', label: 'Caption' },
      },
    },
  },
} as const satisfies CollectionDefinition;

export type PostsCollection = typeof postsCollection;
`;

const docsCollection =
  (): string => `import type { CollectionDefinition } from '@createcms/core';

export const docsCollection = {
  label: 'Docs',
  description: 'Nested documentation pages.',
  slug: { enabled: true, root: '/docs', nested: true, normalize: true },
  root: {
    properties: {
      title: {
        type: 'string',
        label: 'Title',
        required: true,
        defaultValue: 'Untitled page',
      },
    },
  },
  blocks: {
    richText: {
      label: 'Rich Text',
      description: 'A block of formatted text.',
      properties: {
        content: { type: 'richText', label: 'Content', required: true },
      },
    },
    callout: {
      label: 'Callout',
      description: 'A highlighted note.',
      properties: {
        variant: {
          type: 'select',
          label: 'Variant',
          defaultValue: 'info',
          options: [
            { label: 'Info', value: 'info' },
            { label: 'Warning', value: 'warning' },
            { label: 'Tip', value: 'tip' },
          ],
        },
        content: { type: 'richText', label: 'Content', required: true },
      },
    },
  },
} as const satisfies CollectionDefinition;

export type DocsCollection = typeof docsCollection;
`;

/** The shipped presets, keyed by `--preset <name>`. */
export const PRESETS: Record<string, Preset> = {
  pages: {
    name: 'pages',
    description: 'Marketing & content pages (the default).',
    fileName: 'pages',
    exportName: 'pagesCollection',
    collectionKey: 'pages',
    collection: pagesCollection,
  },
  blog: {
    name: 'blog',
    description: 'A blog: posts with excerpt, date, cover image + rich text.',
    fileName: 'posts',
    exportName: 'postsCollection',
    collectionKey: 'posts',
    collection: postsCollection,
  },
  docs: {
    name: 'docs',
    description: 'Nested documentation pages with callouts.',
    fileName: 'docs',
    exportName: 'docsCollection',
    collectionKey: 'docs',
    collection: docsCollection,
  },
};

export const DEFAULT_PRESET = 'pages';

/** `<baseDir>/lib/cms.ts` — the createCMS config, wired to the chosen preset. */
const cmsConfigTemplate = (
  preset: Preset,
  layout: ProjectLayout,
): string => `import { createCMS, CMSError } from '@createcms/core';

import { ${preset.exportName} } from '${layout.alias}/cms/collections/${preset.fileName}';
// TODO: point this at YOUR Drizzle client (a DrizzleInstance). createcms does
// not scaffold the database client — wire your own (see https://orm.drizzle.team).
import { db } from '${layout.alias}/lib/db';

export const cms = createCMS({
  db,
  // Where \`createcms generate\` writes the Drizzle schema for the CMS tables.
  schema: {
    output: './${inBase(layout, 'db/schema/cms.ts')}',
  },
  collections: {
    ${preset.collectionKey}: ${preset.exportName},
  },
  // Media uploads target any S3-compatible bucket. Fill from your environment.
  media: {
    provider: 'aws',
    region: process.env.S3_REGION!,
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    bucketName: process.env.S3_BUCKET!,
    publicUrl: process.env.S3_PUBLIC_URL!,
  },
  // Published content is public; everything else requires auth. Replace the
  // TODO with your real session/permission check: return { userId } to allow,
  // throw \`new CMSError('UNAUTHORIZED')\` (401) or \`'FORBIDDEN'\` (403) to deny.
  authMiddleware: async (ctx) => {
    if (ctx.permissionResource === 'publishedContent') return {};
    // TODO: resolve the signed-in user / permissions here.
    throw new CMSError('UNAUTHORIZED');
  },
});
`;

/** `<baseDir>/app/api/cms/[[...rest]]/route.ts` — mounts the CMS HTTP router. */
const routeHandlerTemplate = (layout: ProjectLayout): string =>
  `import { cms } from '${layout.alias}/lib/cms';

const { handler } = cms.router;

export const GET = handler;
export const POST = handler;
`;

/** `.env.example` — the env vars the scaffolded config reads. */
const envExampleTemplate =
  (): string => `# The CMS database — any Postgres connection string.
DATABASE_URL=

# Media uploads — any S3-compatible bucket.
S3_REGION=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET=
S3_PUBLIC_URL=
`;

/** The npm script `init` adds to package.json. */
export const GENERATE_SCRIPT = {
  name: 'cms:generate',
  command: 'createcms generate',
};

/**
 * The files `init` scaffolds for a chosen preset, relative to the project root.
 * Order is display order. Paths are prefixed with `layout.baseDir` (`src/` or
 * root) so the scaffold matches the project's layout; `.env.example` always
 * lands at the root.
 */
export function buildInitFiles(
  preset: Preset,
  layout: ProjectLayout,
): ReadonlyArray<{ path: string; content: () => string }> {
  return [
    {
      path: inBase(layout, 'lib/cms.ts'),
      content: () => cmsConfigTemplate(preset, layout),
    },
    {
      path: inBase(layout, `cms/collections/${preset.fileName}.ts`),
      content: preset.collection,
    },
    {
      path: inBase(layout, 'app/api/cms/[[...rest]]/route.ts'),
      content: () => routeHandlerTemplate(layout),
    },
    { path: '.env.example', content: envExampleTemplate },
  ];
}

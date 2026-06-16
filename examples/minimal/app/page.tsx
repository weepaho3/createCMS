// Server-safe render entry point. The `@createcms/core/react` barrel also
// re-exports the client (`createCMSClient`, `useStore`), which pulls React
// hooks into a Server Component; importing the `/react/blocks` subpath keeps
// this page server-only.
import { BlocksRenderer, createBlocksMap } from '@createcms/core/react/blocks';

import { cms } from '@/lib/cms';
import { seeded } from '@/lib/cms-data';
import { collections } from '@/lib/collections';

// Read CMS data at request time, never at build time, so `next build` does not
// touch the database. REQUIRED for every page that reads CMS content.
export const dynamic = 'force-dynamic';

// Map each block type in the `pages` collection to a React component. The
// `properties` of each block are fully typed from the collection definition.
const pageBlocks = createBlocksMap(collections.pages, {
  hero: ({ properties }) => <h1>{properties.headline}</h1>,
  richText: ({ properties }) => (
    // `richText` stores markup; render it as HTML (sanitize if untrusted).
    <div dangerouslySetInnerHTML={{ __html: properties.content }} />
  ),
});

export default async function Page() {
  await seeded();

  const { variants } = await cms.api.pages.getPublishedContent({
    query: { path: '/welcome' },
  });

  return (
    <main style={{ maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <BlocksRenderer blocks={pageBlocks} tree={variants[0]!.tree} />
    </main>
  );
}

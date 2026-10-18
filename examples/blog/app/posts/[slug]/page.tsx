// Server-safe render entry point. The `@createcms/core/react` barrel also
// re-exports the client (`createCMSClient`, `useStore`), which pulls React
// hooks into a Server Component; importing the `/react/blocks` subpath keeps
// this page server-only.
import {
  BlocksRenderer,
  createBlocksMap,
  RichText,
} from '@createcms/core/react/blocks';
import Link from 'next/link';

import { cms } from '@/lib/cms';
import { seeded } from '@/lib/cms-data';
import { collections } from '@/lib/collections';

// Read CMS data at request time, never at build time, so `next build` does not
// touch the database. REQUIRED for every page that reads CMS content.
export const dynamic = 'force-dynamic';

// Map each block type in the `posts` collection to a React component. The
// `properties` of each block are fully typed from the collection definition.
const postBlocks = createBlocksMap(collections.posts, {
  // `richText` is stored as JSON and renders as plain React elements;
  // internal links come back resolved, `Link` keeps navigation client-side.
  richText: ({ properties }) => (
    <div>
      <RichText
        value={properties.content}
        components={{
          link: ({ href, children }) =>
            href?.startsWith('/') ? (
              <Link href={href}>{children}</Link>
            ) : (
              <a href={href}>{children}</a>
            ),
        }}
      />
    </div>
  ),
  quote: ({ properties }) => (
    <blockquote>
      {properties.text}
      {properties.cite ? <cite> — {properties.cite}</cite> : null}
    </blockquote>
  ),
});

export default async function PostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await seeded();
  const { slug } = await params;

  const { variants } = await cms.api.posts.getPublishedContent({
    query: { path: `/blog/${slug}` },
  });

  return (
    <main style={{ maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <p>
        <Link href="/">← Back to all posts</Link>
      </p>
      <BlocksRenderer blocks={postBlocks} tree={variants[0]!.tree} />
    </main>
  );
}

import Link from 'next/link';

import { cms } from '@/lib/cms';
import { seeded } from '@/lib/cms-data';

// Read CMS data at request time, never at build time, so `next build` does not
// touch the database. REQUIRED for every page that reads CMS content.
export const dynamic = 'force-dynamic';

export default async function BlogIndex() {
  await seeded();

  const { roots } = await cms.api.posts.listRoots({
    query: { sortBy: 'createdAt', sortDirection: 'desc' },
  });

  return (
    <main style={{ maxWidth: 640, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Blog</h1>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {roots.map((post) => {
          // `slug` is the post's own segment; the full path is `/blog/<slug>`.
          const slug = post.slug ?? '';
          return (
            <li key={post.rootId} style={{ margin: '2rem 0' }}>
              <h2 style={{ marginBottom: '0.25rem' }}>
                <Link href={`/posts/${slug}`}>{post.properties.title}</Link>
              </h2>
              {post.properties.excerpt ? (
                <p style={{ margin: 0, color: '#555' }}>
                  {post.properties.excerpt}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </main>
  );
}

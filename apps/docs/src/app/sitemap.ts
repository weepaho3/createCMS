import type { MetadataRoute } from 'next';

import { source } from '@/lib/source';

// Same env-driven base as the layout metadataBase so entries stay absolute
// before the canonical domain is finalized.
const baseUrl = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://createcms.dev';

export default function sitemap(): MetadataRoute.Sitemap {
  return source.getPages().map((page) => ({
    url: `${baseUrl}${page.url}`,
    lastModified: new Date(),
  }));
}

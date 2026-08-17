import type { MetadataRoute } from 'next';

// Same env-driven base as the layout metadataBase so the sitemap link stays
// absolute before the canonical domain is finalized.
const baseUrl = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://createcms.dev';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/demo',
    },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}

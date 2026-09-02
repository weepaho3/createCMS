import type { Metadata } from 'next';

import { RootProvider } from 'fumadocs-ui/provider/next';

import './global.css';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';

import { COPY, HOME_OG_IMAGE } from '@/lib/launch-copy';

// Title template + brand defaults. The favicon is wired automatically by the
// `app/icon.svg` file convention (no `icons` field needed here).
export const metadata: Metadata = {
  // Env-driven so relative openGraph.images resolve to absolute URLs before the
  // canonical domain is finalized. Update the fallback once the real docs domain
  // is set (or set NEXT_PUBLIC_DOCS_URL in the deploy environment).
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://createcms.dev',
  ),
  title: {
    default: COPY.title,
    template: '%s | createCMS',
  },
  description: COPY.description,
  openGraph: {
    title: COPY.title,
    description: COPY.ogDescription,
    siteName: COPY.title,
    type: 'website',
    images: [HOME_OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: COPY.title,
    description: COPY.ogDescription,
    images: [HOME_OG_IMAGE.url],
  },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}
      suppressHydrationWarning
    >
      <body className={'flex flex-col min-h-screen'}>
        <RootProvider>
          <div className="w-full border-b border-amber-500/25 bg-amber-500/15 px-4 py-2 text-center text-sm text-amber-700 dark:text-amber-300">
            ⚠️ <strong>Work in progress</strong> — createCMS is pre-1.0 and{' '}
            <strong>not production-ready</strong> (not tested in production).
            Expect breaking changes.
          </div>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}

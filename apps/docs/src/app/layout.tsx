import { RootProvider } from 'fumadocs-ui/provider/next';

import './global.css';
import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';

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
            <strong>not production-ready</strong> (not tested in production). Expect
            breaking changes.
          </div>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}

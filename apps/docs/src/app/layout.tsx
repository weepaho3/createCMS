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
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}

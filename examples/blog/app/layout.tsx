import type { ReactNode } from 'react';

export const metadata = {
  title: '@createcms/core — blog example',
  description: 'A blog: a posts collection with a list page and a detail page.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

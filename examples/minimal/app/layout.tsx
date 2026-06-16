import type { ReactNode } from 'react';

export const metadata = {
  title: '@createcms/core — minimal example',
  description: 'The quickstart wiring: a pages collection rendered by path.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

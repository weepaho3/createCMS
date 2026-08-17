import type { Metadata } from 'next';

import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Editor demo',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const links = [
  { href: '/docs/guides/visual-editor', label: 'Visual editor guide' },
  { href: '/demo/editor', label: 'Demos index' },
  { href: '/demo/editor/pages', label: 'Live canvas' },
  { href: '/demo/editor/form', label: 'Form only' },
  { href: '/demo/editor/preview', label: 'Form plus preview' },
  { href: '/demo/editor/email', label: 'Email split' },
];

export default function DemoLayout({ children }: LayoutProps<'/demo'>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-border flex shrink-0 items-center gap-4 border-b px-4 py-2 text-sm">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-muted-foreground hover:text-foreground"
          >
            {link.label}
          </Link>
        ))}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

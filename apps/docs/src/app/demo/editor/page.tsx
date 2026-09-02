import Link from 'next/link';

const demos = [
  {
    href: '/demo/editor/pages',
    title: 'Live canvas',
    description:
      'Live canvas with sidebar chrome, palette, outline, and inspector.',
  },
  {
    href: '/demo/editor/form',
    title: 'Form only',
    description: 'Inspector form without a canvas preview.',
  },
  {
    href: '/demo/editor/preview',
    title: 'Form plus preview',
    description: 'Side-by-side form and BlocksRenderer preview.',
  },
  {
    href: '/demo/editor/email',
    title: 'Email split',
    description: 'Form pane and compiled HTML iframe via react-email.',
  },
];

export default function DemoEditorIndexPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold">Editor demos</h1>
      <p className="text-muted-foreground text-sm">
        Runnable compositions from the docs registry. No createcms server or
        database.
      </p>
      <ul className="flex flex-col gap-4">
        {demos.map((demo) => (
          <li key={demo.href}>
            <Link href={demo.href} className="font-medium hover:underline">
              {demo.title}
            </Link>
            <p className="text-muted-foreground text-sm">{demo.description}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}

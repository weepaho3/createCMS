import Link from 'next/link';

import CreateCMSLogoAnimation from '@/components/createcms-logo-animation';

const features = [
  {
    title: 'Git-like versioning',
    body: 'Branches, copy-on-write drafts, visual diffs, and merges — native to your database.',
  },
  {
    title: 'Composable blocks',
    body: 'Nested pages and reusable blocks, defined in code as fully typed collections.',
  },
  {
    title: 'Type-safe end to end',
    body: 'Collections → server API → client, all inferred. No codegen drift, no any.',
  },
  {
    title: 'Plugins included',
    body: 'Multi-tenant, i18n, A/B testing, consent, and media optimization out of the box.',
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center px-4 py-20">
      <section className="flex w-full max-w-4xl flex-col items-start text-left">
        <span className="mb-6 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
          ⚠️ Pre-1.0 · work in progress · not production-ready
        </span>

        {/* The animated brand mark IS the headline. The SVG is decorative
            (per-glyph animated text), so the accessible name comes from the
            <h1>'s aria-label. */}
        <h1 aria-label="createCMS" className="w-full">
          <CreateCMSLogoAnimation
            ink="var(--cc-ink)"
            accent="var(--cc-accent)"
            fontFamily="var(--font-geist-sans), system-ui, sans-serif"
            maxWidth="100%"
            style={{ justifyContent: 'flex-start' }}
          />
        </h1>

        <p className="mt-8 max-w-2xl text-2xl font-medium tracking-tight text-balance">
          Build your CMS into your app — not your app into a CMS.
        </p>
        <p className="mt-4 max-w-2xl text-lg text-fd-muted-foreground">
          Define your content in code, get a fully type-safe API, and build
          exactly the CMS your product needs — with your content and its full
          Git-like history living in your own database.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-start gap-3">
          <Link
            href="/docs"
            className="rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground"
          >
            Read the docs
          </Link>
          <a
            href="https://github.com/weepaho3/createCMS"
            className="rounded-lg border border-fd-border px-5 py-2.5 text-sm font-medium"
          >
            GitHub
          </a>
        </div>

        <code className="mt-6 rounded-lg border border-fd-border bg-fd-muted px-4 py-2 text-sm">
          bun add @createcms/core
        </code>
      </section>

      <section className="mt-20 grid w-full max-w-4xl gap-4 sm:grid-cols-2">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border border-fd-border p-5">
            <h2 className="font-semibold">{f.title}</h2>
            <p className="mt-1.5 text-sm text-fd-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}

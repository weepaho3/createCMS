import Link from 'next/link';

import CreateCMSLogoAnimation from '@/components/createcms-logo-animation';
import { COPY, FEATURES } from '@/lib/launch-copy';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center px-4 py-20">
      <section className="flex w-full max-w-4xl flex-col items-start text-left">
        <span className="mb-6 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
          {COPY.eyebrow}
        </span>

        {/* Animated brand mark. The H1 is the frozen primary line (CMS-77). */}
        <div className="w-full" aria-hidden="true">
          <CreateCMSLogoAnimation
            ink="var(--cc-ink)"
            accent="var(--cc-accent)"
            fontFamily="var(--font-geist-sans), system-ui, sans-serif"
            maxWidth="100%"
            style={{ justifyContent: 'flex-start' }}
          />
        </div>

        <h1 className="mt-8 max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          {COPY.primary}
        </h1>
        <p className="mt-4 max-w-2xl text-2xl font-medium tracking-tight text-balance">
          {COPY.subhead}
        </p>
        <p className="mt-4 max-w-2xl text-lg text-fd-muted-foreground">
          {COPY.support}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-start gap-3">
          <Link
            href="/docs"
            className="rounded-lg bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground"
          >
            {COPY.ctaPrimary}
          </Link>
          <a
            href="https://github.com/weepaho3/createCMS"
            className="rounded-lg border border-fd-border px-5 py-2.5 text-sm font-medium"
          >
            {COPY.ctaSecondary}
          </a>
        </div>

        <code className="mt-6 rounded-lg border border-fd-border bg-fd-muted px-4 py-2 text-sm">
          {COPY.install}
        </code>
      </section>

      <section className="mt-20 grid w-full max-w-4xl gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-xl border border-fd-border p-5">
            <h2 className="font-semibold">{f.title}</h2>
            <p className="mt-1.5 text-sm text-fd-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}

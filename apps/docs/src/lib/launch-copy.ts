/**
 * CMS-72 verbal freeze + CMS-77 launch copy pack. Frozen lines — do not rewrite.
 * Source: Linear "Verbal Identity v1 (CMS-72) — FREEZE" (2026-09-03 revision).
 */

export const BRAND_ACCENT = '#ea580c';
export const BRAND_INK = '#1c1917';
export const BRAND_INK_INVERSE = '#fafaf9';

export const COPY = {
  primary: 'Your Postgres. Your content. Your CMS.',
  subhead: 'Typed content and a Git-like API, living in your Postgres.',
  // Argument/announce only — not the hero subhead (CMS-72).
  launchAlternate: 'Build your CMS into your app, not your app into a CMS.',
  eyebrow: 'Pre-1.0 · work in progress',
  // Kept for non-hero surfaces; Option E drops this from the homepage hero.
  support:
    'Define typed collections in code, get a fully inferred API, and keep Git-like history in your own database.',
  ctaPrimary: 'Read the docs',
  ctaSecondary: 'GitHub',
  install: 'bun add @createcms/core',
  title: 'createCMS',
  description:
    'A composable, Git-like headless CMS for TypeScript. Your Postgres. Your content. Your CMS.',
  ogDescription:
    'Your Postgres. Your content. Your CMS. Typed content and a Git-like API, living in your Postgres.',
} as const;

export const FEATURES = [
  {
    title: 'Git-like versioning',
    body: 'Branches, copy-on-write drafts, diffs, and merges: native to your database.',
  },
  {
    title: 'Composable blocks',
    body: 'Nested pages and reusable blocks, defined in code as fully typed collections.',
  },
  {
    title: 'Type-safe end to end',
    body: 'Collections → server API → client, all inferred. No codegen drift.',
  },
  {
    title: 'Optional plugins',
    body: 'Multi-tenant, i18n, A/B testing, consent, and media optimization when you need them.',
  },
] as const;

export const HOME_OG_IMAGE = {
  url: '/og/home',
  width: 1200,
  height: 630,
  alt: 'createCMS',
} as const;

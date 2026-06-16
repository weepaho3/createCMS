/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Keep these out of the server bundle so Next resolves them via the package
  // `exports` map at runtime instead of statically analyzing their optional
  // sub-dependencies (e.g. drizzle-kit's `postgres`/`pg` drivers, which this
  // example never uses since it runs on PGlite).
  serverExternalPackages: [
    '@createcms/core',
    '@electric-sql/pglite',
    'drizzle-kit',
    'drizzle-orm',
  ],
};

export default config;

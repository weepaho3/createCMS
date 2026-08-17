import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

// createMDX() starts .source generation without awaiting it. `next typegen`
// loads this config, so docs `check-types` runs `fumadocs-mdx` after
// `next typegen`: the last writer of .source must finish before tsc.

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  transpilePackages: [
    '@createcms/core',
    '@createcms/react',
    '@react-email/components',
    '@react-email/render',
  ],
};

export default withMDX(config);

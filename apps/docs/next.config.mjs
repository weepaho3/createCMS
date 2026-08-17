import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

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

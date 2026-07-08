import { source } from '@/lib/source';

export const revalidate = false;

// Concise llms.txt index: title, description, and a link list of every page.
// The full text lives at /llms-full.txt.
export async function GET() {
  const pages = source.getPages();

  const links = pages
    .map((page) => {
      const description = page.data.description
        ? `: ${page.data.description}`
        : '';

      return `- [${page.data.title}](${page.url})${description}`;
    })
    .join('\n');

  const body = `# createCMS

A composable, block-based, Git-like headless CMS for TypeScript — powered by Drizzle ORM, with a fully type-safe API.

## Docs

${links}
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

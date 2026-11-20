import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// @ts-expect-error plain ESM script without types
import { mdxToMarkdown, packages, renderPackage } from './package-docs.mjs';

const page = (
  body: string,
  slug = 'guides/example',
  shipped = new Set<string>(),
) =>
  mdxToMarkdown(
    `---\ntitle: Example\ndescription: One page.\n---\n\n${body}`,
    slug,
    shipped,
  );

describe('package docs', () => {
  it('turns the MDX components into Markdown', () => {
    const { markdown, unknown } =
      page(`<Callout type="warn">Pin the version.</Callout>

<Cards>
  <Card title="Blocks" href="/docs/concepts/blocks">Typed content.</Card>
</Cards>

## Create [#create]

<APIMethod
  method="POST"
  path="/{collection}/createRoot"
  fn="createRoot"
  resource="root"
  operation="create"
  args={\`{
body: { slug: 'a' },
}\`}
  returns={{ rootId: { type: 'string', description: 'The \`id\`.' } }}
/>`);
    expect(unknown.size).toBe(0);
    expect(markdown).toContain('# Example\n\nOne page.');
    expect(markdown).toContain('> **Warning:** Pin the version.');
    expect(markdown).toContain(
      '- [Blocks](https://createcms.dev/docs/concepts/blocks): Typed content.',
    );
    expect(markdown).toContain('<a id="create"></a>\n\n## Create\n');
    expect(markdown).toContain(
      "const data = await cms.api.pages.createRoot({\n  body: { slug: 'a' },\n});",
    );
    expect(markdown).toContain('Permission: `root:create`');
    expect(markdown).toMatch(/\| `rootId` \| `string` \|\s+\| The `id`\.\s+\|/);
  });

  it('links shipped pages relatively, and the rest to the site', () => {
    const { markdown } = page(
      '[blocks](/docs/concepts/blocks#types), [concepts](/docs/concepts), [roots](/docs/reference/roots)',
      'guides/example',
      new Set(['concepts/blocks', 'concepts/index']),
    );
    expect(markdown).toContain('[blocks](../concepts/blocks.md#types)');
    expect(markdown).toContain('[concepts](../concepts/index.md)');
    expect(markdown).toContain(
      '[roots](https://createcms.dev/docs/reference/roots)',
    );
  });

  it('reports a component it has no Markdown for', () => {
    expect([...page('<Mystery />').unknown]).toEqual(['Mystery']);
  });

  it.each(Object.keys(packages))(
    'renders every page of %s, and every link inside the package resolves',
    async (id) => {
      const { files, unknown } = await renderPackage(id, '0.0.0');
      expect([...unknown]).toEqual([]);
      expect(files.has('llms.txt')).toBe(true);
      const broken: string[] = [];
      for (const [file, body] of files as Map<string, string>) {
        for (const [, target] of body.matchAll(/\]\((\.{1,2}\/[^)#\s]+)/g)) {
          const resolved = path.posix.normalize(
            path.posix.join(path.posix.dirname(file), target!),
          );
          if (!files.has(resolved)) broken.push(`${file} -> ${target}`);
        }
      }
      expect(broken).toEqual([]);
    },
  );

  it('the skill only names pages that ship', async () => {
    const skill = await readFile(
      path.resolve(
        import.meta.dirname,
        '../../../packages/cms/skills/createcms/SKILL.md',
      ),
      'utf8',
    );
    const { files: core } = await renderPackage('core', '0.0.0');
    const { files: react } = await renderPackage('react', '0.0.0');
    const named = [
      ...skill.matchAll(
        /`((?:concepts|guides|reference)\/[\w-]+\.md|quickstart\.md)`/g,
      ),
    ].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(5);
    for (const file of named) {
      expect(core.has(file) || react.has(file), file).toBe(true);
    }
  });
});

// Writes the docs as Markdown into each package's `docs/` folder, so whoever
// installs a package reads the docs of that release in node_modules, with
// no access to the site.
//
//   node apps/docs/scripts/package-docs.mjs          Every package.
//   node apps/docs/scripts/package-docs.mjs react    One.
//   node apps/docs/scripts/package-docs.mjs --check  Fails when a package's docs are stale.

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { SKIP, visit } from 'unist-util-visit';
import { parse as parseYaml } from 'yaml';

const docsApp = path.resolve(import.meta.dirname, '..');
const repo = path.resolve(docsApp, '../..');
const content = path.join(docsApp, 'content/docs');
const SITE = 'https://createcms.dev/docs';

const SHARED = ['index', 'installation', 'quickstart', /^concepts\//];

const isReact = (slug) =>
  /^reference\/(react|editor-errors)/.test(slug) ||
  /^guides\/(editor-|building-an-editor|visual-editor|visual-diff|rich-text|rendering-content|media-library|custom-doc-store|draft-preview)/.test(
    slug,
  );

const matches = (slug, rules) =>
  rules.some((rule) =>
    typeof rule === 'string' ? rule === slug : rule.test(slug),
  );

export const packages = {
  react: {
    dir: 'react',
    name: '@createcms/react',
    summary:
      'Headless React primitives for createCMS: the block editor (`Editor.*`), the canvas (`Canvas.*`), rich text, rendering, collaboration, the media library and the tree. Unstyled, shadcn style: namespaced parts, `render` props, `data-*` state.',
    start: [
      ['guides/building-an-editor', 'Build an editor from the parts.'],
      ['reference/react-editor', 'Every `Editor.*` part and hook.'],
      ['reference/react-editor-canvas', 'The visual canvas.'],
      ['guides/editor-ui', 'The ready-made editor UI (shadcn registry).'],
      ['guides/editor-ui-sdk', 'The editor UI on Vercel UI SDK.'],
    ],
    pages: (slug) => matches(slug, SHARED) || isReact(slug),
  },
  core: {
    dir: 'cms',
    name: '@createcms/core',
    summary:
      'The createCMS server: collections and blocks, Git-like branches, commits, merges, publishing, media, search, permissions and the typed server and client API, on Drizzle ORM and Postgres.',
    start: [
      ['quickstart', 'Set up createCMS.'],
      ['reference/define', '`defineCollection`, `defineBlock` and the schema.'],
      ['reference/server-api', 'The server API.'],
      ['reference/client-api', 'The typed client.'],
      ['concepts/how-it-works', 'How the pieces fit together.'],
    ],
    pages: (slug) =>
      matches(slug, SHARED) ||
      (!isReact(slug) && slug !== 'changelog' && slug !== 'breaking-changes'),
  },
};

async function walk(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      out.push(...(await walk(path.join(dir, entry.name), rel)));
    else if (entry.name.endsWith('.mdx')) out.push(rel.replace(/\.mdx$/, ''));
  }
  return out;
}

async function order() {
  const sorted = [];
  async function folder(dir, prefix) {
    const meta = JSON.parse(
      await readFile(path.join(dir, 'meta.json'), 'utf8'),
    );
    const names = (await readdir(dir, { withFileTypes: true })).map(
      (e) => e.name,
    );
    const listed = meta.pages.filter(
      (p) => !p.startsWith('---') && p !== '...',
    );
    const rest = names
      .filter((n) => n.endsWith('.mdx') || !n.includes('.'))
      .map((n) => n.replace(/\.mdx$/, ''))
      .filter((n) => !listed.includes(n) && n !== 'meta');
    for (const name of [
      ...listed,
      ...(meta.pages.includes('...') ? rest.sort() : []),
    ]) {
      const slug = prefix ? `${prefix}/${name}` : name;
      const sub = path.join(dir, name);
      if (names.includes(name)) await folder(sub, slug);
      else sorted.push(slug);
    }
  }
  await folder(content, '');
  return sorted;
}

function frontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source);
  if (!match) return { data: {}, body: source };
  return {
    data: parseYaml(match[1]) ?? {},
    body: source.slice(match[0].length),
  };
}

function evaluate(expression) {
  try {
    return runInNewContext(`(${expression})`, {}, { timeout: 100 });
  } catch {
    return undefined;
  }
}

const attr = (node, name) => {
  const found = node.attributes?.find((a) => a.name === name);
  if (!found) return undefined;
  if (found.value === null || found.value === undefined) return true;
  if (typeof found.value === 'string') return found.value;
  return evaluate(found.value.value);
};

const text = (value) => ({ type: 'text', value });
const inline = (value) => ({ type: 'inlineCode', value });
const paragraph = (...children) => ({ type: 'paragraph', children });
const code = (lang, value) => ({ type: 'code', lang, value });

function plainOf(node) {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  return (node.children ?? []).map(plainOf).join('');
}

function reindent(source) {
  let depth = 0;
  return source
    .split('\n')
    .map((raw) => {
      const line = raw.trim();
      const closes = /^[}\])]/.test(line);
      const indent = '  '.repeat(Math.max(0, depth - (closes ? 1 : 0)));
      for (const char of line.replace(/(['"`]).*?\1/g, '')) {
        if ('{[('.includes(char)) depth += 1;
        if ('}])'.includes(char)) depth -= 1;
      }
      return line ? indent + line : line;
    })
    .join('\n');
}

function inlineMarkdown(value) {
  const tree = processor.parse(String(value ?? ''));
  return tree.children[0]?.type === 'paragraph'
    ? tree.children[0].children
    : [text(String(value ?? ''))];
}

function apiMethod(node) {
  const fn = attr(node, 'fn');
  const method = attr(node, 'method');
  const route = attr(node, 'path');
  const collection = attr(node, 'collection') ?? 'pages';
  const raw = attr(node, 'args');
  const args = typeof raw === 'string' ? reindent(raw) : undefined;
  const call = (lhs, base) => `${lhs} = await ${base}.${fn}(${args ?? ''});`;
  const out = [
    paragraph(inline(`${method} ${route}`)),
    code(
      'ts',
      `// Server\n${call('const data', `cms.api.${collection}`)}\n\n// Client\n${call('const { data, error }', `client.${collection}`)}`,
    ),
  ];
  const resource = attr(node, 'resource');
  const operation = attr(node, 'operation');
  if (resource && operation) {
    out.push(
      paragraph(text('Permission: '), inline(`${resource}:${operation}`)),
    );
  }
  if (attr(node, 'public'))
    out.push(paragraph(text('Public: no session needed.')));
  const table = (title, record, flag) => {
    if (!record || typeof record !== 'object') return;
    const rows = Object.entries(record).map(([key, value]) => ({
      type: 'tableRow',
      children: [
        { type: 'tableCell', children: [inline(key)] },
        { type: 'tableCell', children: [inline(String(value?.type ?? ''))] },
        { type: 'tableCell', children: [text(flag(value))] },
        { type: 'tableCell', children: inlineMarkdown(value?.description) },
      ],
    }));
    out.push(paragraph({ type: 'strong', children: [text(title)] }));
    out.push({
      type: 'table',
      align: [null, null, null, null],
      children: [
        {
          type: 'tableRow',
          children: ['Field', 'Type', '', 'Description'].map((h) => ({
            type: 'tableCell',
            children: [text(h)],
          })),
        },
        ...rows,
      ],
    });
  };
  table('Parameters', attr(node, 'params'), (v) =>
    [v?.required ? 'required' : '', v?.default ? `= ${v.default}` : '']
      .filter(Boolean)
      .join(' '),
  );
  table('Returns', attr(node, 'returns'), (v) =>
    v?.optional ? 'optional' : '',
  );
  return out;
}

const CALLOUT = {
  warn: 'Warning',
  warning: 'Warning',
  error: 'Important',
  info: 'Note',
};

function convert(tree, unknown) {
  visit(tree, (node, index, parent) => {
    if (!parent || index === undefined) return;
    if (
      node.type === 'mdxjsEsm' ||
      node.type === 'mdxFlowExpression' ||
      node.type === 'mdxTextExpression'
    ) {
      parent.children.splice(index, 1);
      return [SKIP, index];
    }
    if (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement')
      return;
    let replacement;
    switch (node.name) {
      case 'APIMethod':
        replacement = apiMethod(node);
        break;
      case 'Callout': {
        const label = CALLOUT[attr(node, 'type')] ?? 'Note';
        const title = attr(node, 'title');
        const phrasing = node.children.every((c) =>
          [
            'text',
            'inlineCode',
            'strong',
            'emphasis',
            'link',
            'mdxJsxTextElement',
            'break',
            'delete',
          ].includes(c.type),
        );
        const children =
          node.children.length === 0
            ? [paragraph()]
            : phrasing
              ? [paragraph(...node.children)]
              : node.children;
        const first =
          children[0].type === 'paragraph' ? children[0] : paragraph();
        if (first !== children[0]) children.unshift(first);
        first.children.unshift(
          {
            type: 'strong',
            children: [text(`${label}${title ? `: ${title}` : ''}:`)],
          },
          text(' '),
        );
        replacement = [{ type: 'blockquote', children }];
        break;
      }
      case 'Cards':
        replacement = [
          {
            type: 'list',
            ordered: false,
            children: node.children.flatMap((c) =>
              c.type === 'listItem' ? [c] : [],
            ),
          },
        ];
        if (replacement[0].children.length === 0) replacement = node.children;
        break;
      case 'Card': {
        const title = attr(node, 'title') ?? '';
        const href = attr(node, 'href');
        const label = href
          ? { type: 'link', url: href, children: [text(title)] }
          : text(title);
        const detail = plainOf(node).trim();
        replacement = [
          {
            type: 'listItem',
            children: [
              paragraph(label, ...(detail ? [text(`: ${detail}`)] : [])),
            ],
          },
        ];
        break;
      }
      case 'Steps':
      case 'Step':
      case 'Tabs':
      case 'Tab':
      case 'Accordions':
      case 'Accordion': {
        const title = attr(node, 'title') ?? attr(node, 'value');
        replacement = [
          ...(typeof title === 'string' && node.type === 'mdxJsxFlowElement'
            ? [paragraph({ type: 'strong', children: [text(title)] })]
            : []),
          ...node.children,
        ];
        break;
      }
      case 'Scene': {
        const title = attr(node, 'title');
        replacement = title
          ? [
              paragraph({
                type: 'emphasis',
                children: [text(`${title} (interactive figure on the site)`)],
              }),
            ]
          : [];
        break;
      }
      default:
        unknown.add(node.name ?? '(fragment)');
        replacement = node.children;
    }
    parent.children.splice(index, 1, ...replacement);
    return [SKIP, index];
  });
  // Cards render as a list once their Card children became list items.
  visit(tree, 'list', (node) => {
    node.children = node.children.flatMap((child) =>
      child.type === 'list' ? child.children : [child],
    );
  });
}

function anchors(tree) {
  visit(tree, 'heading', (node, index, parent) => {
    const last = node.children.at(-1);
    if (last?.type !== 'text') return;
    const match = /\s*\[#([\w-]+)\]\s*$/.exec(last.value);
    if (!match) return;
    last.value = last.value.slice(0, match.index);
    parent.children.splice(index, 0, {
      type: 'html',
      value: `<a id="${match[1]}"></a>`,
    });
    return [SKIP, index + 2];
  });
}

function relink(tree, from, shipped) {
  visit(tree, ['link', 'definition'], (node) => {
    const url = node.url;
    if (!url?.startsWith('/docs')) return;
    const [target, hash] = url
      .slice('/docs'.length)
      .replace(/^\//, '')
      .split('#');
    let slug = target || 'index';
    if (!shipped.has(slug) && shipped.has(`${slug}/index`))
      slug = `${slug}/index`;
    if (shipped.has(slug)) {
      let rel = path.posix.relative(path.posix.dirname(from), `${slug}.md`);
      if (!rel.startsWith('.')) rel = `./${rel}`;
      node.url = `${rel}${hash ? `#${hash}` : ''}`;
    } else {
      node.url = `${SITE}${target ? `/${target}` : ''}${hash ? `#${hash}` : ''}`;
    }
  });
}

const processor = unified()
  .use(remarkParse)
  .use(remarkMdx)
  .use(remarkGfm)
  .use(remarkStringify, { bullet: '-', fences: true, rule: '-' });

const plain = unified()
  .use(remarkGfm)
  .use(remarkStringify, { bullet: '-', fences: true, rule: '-' });

// One page as Markdown: its title and description from the frontmatter, the
// MDX components turned into Markdown, and `/docs` links pointed at the
// shipped pages or the site. `unknown` lists components with no Markdown.
export function mdxToMarkdown(source, slug, shipped = new Set()) {
  const { data, body } = frontmatter(source);
  const tree = processor.parse(body);
  const unknown = new Set();
  convert(tree, unknown);
  anchors(tree);
  relink(tree, `${slug}.md`, shipped);
  const title = data.title ?? slug;
  const description = data.description ?? '';
  const intro = description ? `\n\n${description}` : '';
  const markdown = `# ${title}${intro}\n\n${plain.stringify(tree).trim()}\n`;
  return { markdown, title, description, unknown };
}

export async function renderPackage(id, version) {
  const pkg = packages[id];
  const slugs = (await order()).filter(pkg.pages);
  const known = new Set(await walk(content));
  for (const slug of known) {
    if (!slugs.includes(slug) && pkg.pages(slug)) slugs.push(slug);
  }
  const shipped = new Set(slugs);
  const files = new Map();
  const index = [];
  const unknown = new Set();
  for (const slug of slugs) {
    const source = await readFile(path.join(content, `${slug}.mdx`), 'utf8');
    const page = mdxToMarkdown(source, slug, shipped);
    for (const name of page.unknown) unknown.add(name);
    files.set(`${slug}.md`, page.markdown);
    index.push({ slug, title: page.title, description: page.description });
  }

  const sections = new Map();
  for (const page of index) {
    const section = page.slug.includes('/') ? page.slug.split('/')[0] : 'start';
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section).push(page);
  }
  const heading = {
    start: 'Start',
    concepts: 'Concepts',
    guides: 'Guides',
    reference: 'Reference',
    plugins: 'Plugins',
    resources: 'Resources',
  };
  const list = [...sections]
    .map(
      ([section, pages]) =>
        `## ${heading[section] ?? section}\n\n${pages
          .map(
            (p) =>
              `- [${p.title}](./${p.slug}.md)${p.description ? `: ${p.description}` : ''}`,
          )
          .join('\n')}`,
    )
    .join('\n\n');
  files.set(
    'llms.txt',
    `# ${pkg.name}

> ${pkg.summary}

This file is the context an agent needs to work with ${pkg.name} ${version}: where to start, then every page that ships with this package, generated from the docs at ${SITE} for this release. Read the pages you need; search the larger reference pages by heading. Pages that belong to another package link to the site.

## Where to start

${pkg.start.map(([slug, why]) => `- [${slug}](./${slug}.md): ${why}`).join('\n')}

${list}
`,
  );
  files.set(
    'README.md',
    `# ${pkg.name} docs

The createCMS docs for ${pkg.name} ${version}, as Markdown, generated from the same source as ${SITE}. Start with [llms.txt](./llms.txt).
`,
  );
  return { files, unknown };
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const ids = args.filter((a) => !a.startsWith('--'));
  let stale = false;
  for (const id of ids.length ? ids : Object.keys(packages)) {
    if (!packages[id])
      throw new Error(
        `Unknown package "${id}". Use one of: ${Object.keys(packages).join(', ')}.`,
      );
    const root = path.join(repo, 'packages', packages[id].dir);
    const dir = path.join(root, 'docs');
    const { version } = JSON.parse(
      await readFile(path.join(root, 'package.json'), 'utf8'),
    );
    const { files, unknown } = await renderPackage(id, version);
    if (unknown.size) {
      throw new Error(
        `package-docs: no Markdown for <${[...unknown].join('>, <')}>; add a case to convert().`,
      );
    }
    if (check) {
      for (const [file, body] of files) {
        const current = await readFile(path.join(dir, file), 'utf8').catch(
          () => null,
        );
        if (current !== body) {
          console.error(
            `package-docs: packages/${packages[id].dir}/docs/${file} is stale. Run \`bun run docs:packages\`.`,
          );
          stale = true;
          break;
        }
      }
      continue;
    }
    await rm(dir, { recursive: true, force: true });
    for (const [file, body] of files) {
      await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await writeFile(path.join(dir, file), body);
    }
    console.log(
      `package-docs: packages/${packages[id].dir}/docs (${files.size} files)`,
    );
  }
  if (stale) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

import { highlight } from 'fumadocs-core/highlight';
import { CodeBlock, Pre } from 'fumadocs-ui/components/codeblock';
import { type ReactNode } from 'react';

import {
  ApiMethodCard,
  type APIParam,
  type APIReturn,
  type HttpMethod,
} from './api-method-card';

export type { APIParam, APIReturn };

export interface APIMethodProps {
  /** HTTP verb the endpoint is called with. */
  method: HttpMethod;
  /** Route path. Use `{collection}` for the per-collection segment. */
  path: string;
  /** Sample collection/namespace used in the code (e.g. `pages`, `media`). */
  collection?: string;
  /** The method name, e.g. `createRoot`. */
  fn: string;
  /**
   * The call arguments as a formatted string, including the `body`/`query`
   * wrapper, e.g. `"{\n  body: { slug: 'welcome' },\n}"`. Omit for no-arg calls.
   */
  args?: string;
  /** Which tab to show first. Defaults to `client`. */
  defaultTab?: 'server' | 'client';
  /** Permission resource checked by authorization (e.g. `root`). */
  resource?: string;
  /** Permission operation checked by authorization (`create` | `read` | `update` | `delete`). */
  operation?: string;
  /** The endpoint is reachable without a session (only the public media gate). */
  public?: boolean;
  /** Runs the auth chain but is conventionally anonymous-readable (`publishedContent`). */
  anonymousRead?: boolean;
  /** Request fields (body for `POST`, query for `GET`). */
  params?: Record<string, APIParam>;
  /** Response fields, each with its type and whether it is always present. */
  returns?: Record<string, APIReturn>;
}

/**
 * Re-indent a JS object literal from its bracket structure, so the output is
 * correct regardless of how MDX dedents the authored template literal. Skips
 * brackets inside strings and line comments.
 */
function reindentObject(src: string): string[] {
  const lines = src.trim().split('\n');
  let depth = 0;
  return lines.map((raw) => {
    const line = raw.trim();
    if (line === '') return '';
    const startsWithCloser = /^[}\])]/.test(line);
    const indentDepth = Math.max(0, depth - (startsWithCloser ? 1 : 0));
    let delta = 0;
    let inString: string | null = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inString) {
        if (c === inString && line[i - 1] !== '\\') inString = null;
        continue;
      }
      if (c === '/' && line[i + 1] === '/') break;
      if (c === "'" || c === '"' || c === '`') inString = c;
      else if (c === '{' || c === '[' || c === '(') delta++;
      else if (c === '}' || c === ']' || c === ')') delta--;
    }
    depth += delta;
    return '  '.repeat(indentDepth) + line;
  });
}

function buildCode(
  lhs: string,
  base: string,
  fn: string,
  args?: string,
): string {
  if (!args || args.trim() === '') return `${lhs} = await ${base}.${fn}();`;
  const lines = reindentObject(args);
  lines[0] = `${lhs} = await ${base}.${fn}(${lines[0]}`;
  lines[lines.length - 1] = `${lines[lines.length - 1]});`;
  return lines.join('\n');
}

const HIGHLIGHT_OPTIONS = {
  lang: 'ts',
  themes: { light: 'light-plus', dark: 'github-dark-default' },
  components: {
    pre: (props: React.ComponentProps<typeof Pre>) => (
      <CodeBlock className="my-0 rounded-none border-0 bg-transparent shadow-none">
        <Pre {...props} />
      </CodeBlock>
    ),
  },
} as const;

/**
 * Renders one endpoint the better-auth way: a Client/Server toggle, the call
 * with its typed arguments, the exact `resource:operation` permission it checks,
 * each parameter with its description, and the return shape. Code is highlighted
 * server-side so its indentation is faithful.
 */
export async function APIMethod({
  method,
  path,
  collection = 'pages',
  fn,
  args,
  defaultTab = 'client',
  resource,
  operation,
  public: isPublic,
  anonymousRead,
  params,
  returns,
}: APIMethodProps) {
  const serverCode = buildCode('const data', `cms.api.${collection}`, fn, args);
  const clientCode = buildCode(
    'const { data, error }',
    `client.${collection}`,
    fn,
    args,
  );

  const [serverNode, clientNode] = await Promise.all([
    highlight(serverCode, HIGHLIGHT_OPTIONS),
    highlight(clientCode, HIGHLIGHT_OPTIONS),
  ]);

  return (
    <ApiMethodCard
      method={method}
      path={path}
      defaultTab={defaultTab}
      resource={resource}
      operation={operation}
      public={isPublic}
      anonymousRead={anonymousRead}
      params={params}
      returns={returns}
      serverCode={serverNode}
      clientCode={clientNode}
    />
  );
}

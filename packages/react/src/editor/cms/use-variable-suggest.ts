import * as React from 'react';

import type {
  CmsFieldSources,
  CmsSuggestItem,
  CmsSuggestRenderContext,
  CmsVariableListItem,
  CmsVariableSuggest,
} from './types';

const VARIABLE_PATTERN = /\{\{(\w*)$/;

function defaultRender(ctx: CmsSuggestRenderContext): React.ReactNode {
  return React.createElement(
    'ul',
    { role: 'listbox', 'data-cms-variable-suggest': '' },
    ctx.items.map((item, i) =>
      React.createElement(
        'li',
        {
          key: i,
          role: 'option',
          'aria-selected': i === ctx.highlighted,
        },
        React.createElement(
          'button',
          {
            type: 'button',
            onMouseDown: (event: React.MouseEvent<HTMLButtonElement>) => {
              event.preventDefault();
              ctx.accept(i);
            },
          },
          typeof item.key === 'string' ? item.key : item.insertText,
        ),
      ),
    ),
  );
}

export function useVariableSuggest(
  sources: CmsFieldSources,
): CmsVariableSuggest {
  const [variables, setVariables] = React.useState<CmsVariableListItem[]>([]);
  const listRef = React.useRef(sources.variables.list);
  listRef.current = sources.variables.list;

  React.useEffect(() => {
    let aborted = false;
    const rows: CmsVariableListItem[] = [];

    void (async () => {
      const limit = 100;
      let offset = 0;
      let hasMore = true;

      while (hasMore && offset <= 1000) {
        const page = await listRef.current({ limit, offset });
        if (aborted) return;
        rows.push(...page.variables);
        hasMore = page.hasMore;
        offset += limit;
      }

      if (!aborted) {
        setVariables(rows);
      }
    })();

    return () => {
      aborted = true;
    };
  }, [sources.variables.list]);

  const getItems = React.useCallback(
    (query: string): CmsSuggestItem[] => {
      const needle = query.toLowerCase();
      return variables
        .filter((item) => item.key.toLowerCase().startsWith(needle))
        .map((item) => ({
          insertText: `{{${item.key}}}`,
          key: item.key,
          description: item.description,
        }));
    },
    [variables],
  );

  return React.useMemo(
    (): CmsVariableSuggest => ({
      pattern: VARIABLE_PATTERN,
      getItems,
      render: defaultRender,
    }),
    [getItems],
  );
}

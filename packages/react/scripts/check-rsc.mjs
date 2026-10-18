// Renders a document with the built `@createcms/react/editor/render` entry
// under the `react-server` condition, the React build Server Components get:
// it has no client hooks (`useState`, `useEffect`, `useContext`) and no
// `createContext`, so a render component that reaches for one throws here.
// Components are called directly, the way the server renderer evaluates
// them, and the result must contain the rendered text and link.
//
// Usage: node --conditions=react-server packages/react/scripts/check-rsc.mjs
import * as React from 'react';

if (typeof React.useState === 'function') {
  console.error(
    'check-rsc: run with --conditions=react-server (React resolved to the client build)',
  );
  process.exit(1);
}

const { RichTextStatic, renderDocument } =
  await import('../dist/editor/render/index.js');

/** Evaluates function components and collects the text and hrefs. */
function evaluate(node, out) {
  if (node === null || node === undefined || typeof node === 'boolean') return;
  if (typeof node === 'string' || typeof node === 'number') {
    out.text.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) evaluate(child, out);
    return;
  }
  if (!React.isValidElement(node)) return;
  if (typeof node.type === 'function') {
    evaluate(node.type(node.props), out);
    return;
  }
  if (typeof node.props.href === 'string') out.hrefs.push(node.props.href);
  evaluate(node.props.children, out);
}

const body = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Hello ' },
        {
          type: 'text',
          text: 'server',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        },
      ],
    },
  ],
};

const doc = {
  schemaVersion: 1,
  root: {
    id: 'root',
    type: 'root',
    props: {},
    slots: {
      children: [
        { id: 'h', type: 'heading', props: { text: 'Title' } },
        { id: 'p', type: 'paragraph', props: { body } },
      ],
    },
  },
};

const components = {
  heading: ({ props, edit }) =>
    React.createElement('h1', edit.block, String(props.text)),
  paragraph: ({ props }) =>
    React.createElement(RichTextStatic, { value: props.body }),
};

const out = { text: [], hrefs: [] };
evaluate(renderDocument(doc, components), out);
const text = out.text.join('');
if (text !== 'TitleHello server' || out.hrefs[0] !== 'https://example.com') {
  console.error(
    `check-rsc: unexpected output ${JSON.stringify({ text, hrefs: out.hrefs })}`,
  );
  process.exit(1);
}
console.log(
  'check-rsc: ok (renderDocument and RichTextStatic on react-server)',
);

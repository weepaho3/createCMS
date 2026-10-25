import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';

import type { ParsedHtmlDocument } from './parse-html';

import { htmlToRichText, isLossless } from './parse-html';
import { richTextSchemaOf } from './schema';
import { validateRichText } from './validate';

const window = new Window();
const domParser = (html: string) =>
  new window.DOMParser().parseFromString(
    html,
    'text/html',
  ) as unknown as ParsedHtmlDocument;

const all = richTextSchemaOf({});
const parse = (html: string, schema = all) =>
  htmlToRichText(html, schema, { domParser });

describe('htmlToRichText', () => {
  it('maps the built-in elements', () => {
    const { doc, lossy } = parse(
      '<h2>Title</h2><p>Hi <strong>bold</strong> <em>it</em> <u>u</u> <s>s</s> <code>c</code><br>next <a href="https://x.test" target="_blank">link</a></p>' +
        '<ul><li>one</li><li><p>two</p><ol start="4"><li>deep</li></ol></li></ul>' +
        '<blockquote><p>quote</p></blockquote><pre><code class="language-ts">let a = 1;\nlet b;</code></pre><hr><img data-asset-id="a1" alt="Logo">',
    );
    expect(isLossless(lossy)).toBe(true);
    expect(validateRichText(doc, all)).toEqual([]);
    expect(doc).toMatchSnapshot();
  });

  it('keeps variables as text', () => {
    const { doc } = parse('<p>Hello {{user.name}}, <b>{{count}}</b> items</p>');
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hello {{user.name}}, ' },
          { type: 'text', text: '{{count}}', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' items' },
        ],
      },
    ]);
  });

  it('cleans a Word clipboard', () => {
    const word = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta name=Generator content="Microsoft Word 15"><style>p.MsoNormal{mso-style-unhide:no;}</style></head>
<body lang=DE style='tab-interval:35.4pt'><!--StartFragment-->
<p class=MsoNormal style='mso-margin-top-alt:auto'><b><span style='mso-bidi-font-weight:normal'>Bold</span></b><span style='mso-spacerun:yes'> </span>and <i>italic</i><o:p></o:p></p>
<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'><span style='font-family:Symbol'>·</span> Item<o:p></o:p></p>
<!--EndFragment--></body></html>`;
    const { doc, lossy } = parse(word);
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: '· Item' }] },
    ]);
    expect(lossy.tags).toEqual({});
  });

  it('cleans a Google Docs clipboard', () => {
    const gdocs =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1a2b"><p dir="ltr" style="line-height:1.38"><span style="font-size:11pt;font-weight:700;">Bold</span><span style="font-size:11pt;"> plain </span><span style="font-style:italic;text-decoration:underline;">both</span></p><ul><li dir="ltr"><p dir="ltr"><span>Point</span></p></li></ul></b>';
    const { doc, lossy } = parse(gdocs);
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' plain ' },
          {
            type: 'text',
            text: 'both',
            marks: [{ type: 'italic' }, { type: 'underline' }],
          },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Point' }] },
            ],
          },
        ],
      },
    ]);
    expect(isLossless(lossy)).toBe(true);
  });

  it('parses the demo e-mail content', () => {
    const { doc, lossy } = parse(
      '<p>This email is rendered with react-email and BlocksRenderer.</p>',
    );
    expect(doc).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'This email is rendered with react-email and BlocksRenderer.',
            },
          ],
        },
      ],
    });
    expect(isLossless(lossy)).toBe(true);
  });

  it('reports what it drops', () => {
    const { doc, lossy } = parse(
      '<script>alert(1)</script><p onclick="x()">a <a href="javascript:alert(1)">b</a> <sup>2</sup></p><img src="x.png"><table><tr><td>cell</td></tr></table><iframe src="x"></iframe>',
    );
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'a b 2' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'cell' }] },
    ]);
    expect(lossy).toEqual({
      tags: { script: 1, sup: 1, img: 1, table: 1, iframe: 1 },
      attributes: { 'p[onclick]': 1, 'a[href]': 1 },
      nodes: {},
      marks: {},
    });
  });

  it('degrades what the field does not allow', () => {
    const narrow = richTextSchemaOf({ marks: ['bold'], nodes: ['hardBreak'] });
    const { doc, lossy } = parse(
      '<h1>Head</h1><ul><li>one</li></ul><p><em>it</em> <b>b</b></p>',
      narrow,
    );
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Head' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'it ' },
          { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
        ],
      },
    ]);
    expect(lossy.nodes).toEqual({ heading: 1, bulletList: 1 });
    expect(lossy.marks).toEqual({ italic: 1 });
    expect(validateRichText(doc, narrow)).toEqual([]);
  });

  it('joins blocks for an inline field', () => {
    const inline = richTextSchemaOf({ inline: true });
    const { doc, lossy } = parse('<p>a</p><p>b</p>', inline);
    expect(doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'a' },
          { type: 'hardBreak' },
          { type: 'text', text: 'b' },
        ],
      },
    ]);
    expect(isLossless(lossy)).toBe(true);
    expect(validateRichText(doc, inline)).toEqual([]);
  });

  it('gives an empty paragraph for empty input', () => {
    expect(parse('').doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
  });
});

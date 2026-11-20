import { afterEach, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { RichTextDoc } from '../core/richtext/types';

import { plainTextToRichText } from '../core/richtext/convert';
import { richTextSchemaOf } from '../core/richtext/schema';
import { createTiptapAdapter } from './index';

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

async function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  let value: RichTextDoc = plainTextToRichText('About us');
  const handle = createTiptapAdapter().mount(host, {
    value,
    schema: richTextSchemaOf({ marks: ['bold', 'link'] }),
    onChange: (next) => {
      value = next;
    },
  });
  handle.focus();
  await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}');
  return { handle, value: () => value };
}

const linkOf = (doc: RichTextDoc) =>
  doc.content?.[0]?.content?.[0]?.marks?.find((mark) => mark.type === 'link')
    ?.attrs;

it('sets an internal link with no browser URL and reads it back', async () => {
  const { handle, value } = await mount();
  const target = {
    kind: 'internal',
    collection: 'pages',
    rootId: 'about',
  } as const;
  handle.commands.setLink(target);
  expect(linkOf(value())?.link).toEqual(target);
  expect(handle.commands.getLink?.()).toEqual(target);
  handle.destroy();
});

it('reads an external link back, and null without one', async () => {
  const { handle, value } = await mount();
  expect(handle.commands.getLink?.()).toBeNull();
  handle.commands.setLink({ kind: 'external', url: 'https://createcms.dev' });
  expect(linkOf(value())?.href).toBe('https://createcms.dev');
  expect(handle.commands.getLink?.()).toEqual({
    kind: 'external',
    url: 'https://createcms.dev',
  });
  handle.commands.setLink(null);
  expect(linkOf(value())).toBeUndefined();
  handle.destroy();
});

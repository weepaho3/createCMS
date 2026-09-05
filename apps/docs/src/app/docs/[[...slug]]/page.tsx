import type { Metadata } from 'next';
import type * as React from 'react';

import { createGenerator } from 'fumadocs-typescript';
import { AutoTypeTable } from 'fumadocs-typescript/ui';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from 'fumadocs-ui/layouts/docs/page';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { notFound } from 'next/navigation';

import { TypeTable } from '@/components/type-table';
import { COPY } from '@/lib/launch-copy';
import { getPageImage, source } from '@/lib/source';
import { getMDXComponents } from '@/mdx-components';

const generator = createGenerator();

function DocsAutoTypeTable(
  props: Omit<React.ComponentProps<typeof AutoTypeTable>, 'generator'>,
) {
  return <AutoTypeTable {...props} generator={generator} />;
}

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
            AutoTypeTable: DocsAutoTypeTable,
            TypeTable,
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(
  props: PageProps<'/docs/[[...slug]]'>,
): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const image = getPageImage(page).url;
  const ogTitle = `${page.data.title} | createCMS`;

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      title: ogTitle,
      description: COPY.primary,
      images: image,
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description: COPY.primary,
      images: image,
    },
  };
}

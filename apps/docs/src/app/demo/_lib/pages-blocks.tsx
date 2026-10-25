'use client';

import type { RichTextDoc } from '@createcms/core';
import type { BlockComponentProps } from '@createcms/core/react/blocks';

import { createBlocksMap, RichText } from '@createcms/core/react/blocks';
import { assetUrl } from '@createcms/react/editor/cms';

import { pages } from '@/app/demo/_lib/pages-schema';

function Hero({ properties, edit }: BlockComponentProps) {
  return (
    <section {...edit.block} className="flex flex-col gap-4 p-8">
      {properties.image ? (
        <img
          {...edit.field.image}
          src={assetUrl(properties.image as string)}
          alt=""
          className="max-h-48 w-full object-cover"
        />
      ) : null}
      <h1 {...edit.field.headline} className="text-3xl font-bold">
        {properties.headline as string}
      </h1>
    </section>
  );
}

function FeaturesGrid({ edit, children }: BlockComponentProps) {
  return (
    <div {...edit.block} className="grid grid-cols-1 gap-4 p-8 md:grid-cols-2">
      {children}
    </div>
  );
}

function FeatureItem({ properties, edit }: BlockComponentProps) {
  return (
    <article {...edit.block} className="rounded-md border p-4">
      <h2 {...edit.field.title} className="text-lg font-semibold">
        {properties.title as string}
      </h2>
      {properties.body ? (
        <p {...edit.field.body} className="text-muted-foreground mt-2 text-sm">
          {properties.body as string}
        </p>
      ) : null}
    </article>
  );
}

function ImageBlock({ properties, edit }: BlockComponentProps) {
  // A freshly inserted image block has no src yet; assetUrl rejects empty ids.
  const src = properties.src as string | undefined;
  return (
    <figure {...edit.block} className="p-8">
      {src ? (
        <img
          {...edit.field.src}
          src={assetUrl(src)}
          alt={(properties.alt as string) ?? ''}
          className="max-h-64 w-full object-contain"
        />
      ) : (
        <div
          {...edit.field.src}
          className="bg-muted text-muted-foreground flex h-40 w-full items-center justify-center rounded-md text-sm"
        >
          No image selected
        </div>
      )}
    </figure>
  );
}

function RichTextBlock({ properties, edit }: BlockComponentProps) {
  return (
    <div
      {...edit.block}
      {...edit.field.text}
      className="prose dark:prose-invert max-w-none p-8"
    >
      <RichText value={properties.text as RichTextDoc | undefined} />
    </div>
  );
}

export const pageBlocks = createBlocksMap(pages, {
  hero: Hero,
  featuresGrid: FeaturesGrid,
  featureItem: FeatureItem,
  image: ImageBlock,
  richText: RichTextBlock,
});

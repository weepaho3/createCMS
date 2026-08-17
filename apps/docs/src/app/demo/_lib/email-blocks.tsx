import type { BlockComponentProps } from '@createcms/core/react/blocks';

import { createBlocksMap } from '@createcms/core/react/blocks';
import { Button, Heading, Img, Section, Text } from '@react-email/components';

import { emails } from '@/app/demo/_lib/email-schema';

function demoAssetUrl(id: string): string {
  const origin = process.env.NEXT_PUBLIC_DOCS_URL ?? 'http://localhost:4000';
  return `${origin}/api/cms/media/asset/${encodeURIComponent(id)}`;
}

function EmailHeading({ properties, edit }: BlockComponentProps) {
  return (
    <Heading {...edit.block} {...edit.field.text} as="h1">
      {properties.text as string}
    </Heading>
  );
}

function EmailParagraph({ properties, edit }: BlockComponentProps) {
  return (
    <Section {...edit.block}>
      <Text
        {...edit.field.text}
        dangerouslySetInnerHTML={{ __html: properties.text as string }}
      />
    </Section>
  );
}

function EmailButton({ properties, edit }: BlockComponentProps) {
  return (
    <Section {...edit.block}>
      <Button {...edit.field.label} href={properties.href as string}>
        {properties.label as string}
      </Button>
    </Section>
  );
}

function EmailImage({ properties, edit }: BlockComponentProps) {
  return (
    <Section {...edit.block}>
      <Img
        {...edit.field.src}
        src={demoAssetUrl(properties.src as string)}
        alt={(properties.alt as string) ?? ''}
        width="100%"
      />
    </Section>
  );
}

export const emailBlocks = createBlocksMap(emails, {
  heading: EmailHeading,
  paragraph: EmailParagraph,
  button: EmailButton,
  image: EmailImage,
});

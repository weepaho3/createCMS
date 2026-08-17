import type { BlockTreeNode } from '@createcms/core';

import { BlocksRenderer } from '@createcms/core/react/blocks';
import { Body, Container, Head, Html, Preview } from '@react-email/components';

import { emailBlocks } from '@/app/demo/_lib/email-blocks';

export function EmailDocument({ tree }: { tree: BlockTreeNode }) {
  return (
    <Html>
      <Head />
      <Preview>createCMS email demo</Preview>
      <Body style={{ backgroundColor: '#f6f6f6', margin: 0 }}>
        <Container style={{ backgroundColor: '#ffffff', padding: '24px' }}>
          <BlocksRenderer blocks={emailBlocks} tree={tree} edit="preview" />
        </Container>
      </Body>
    </Html>
  );
}

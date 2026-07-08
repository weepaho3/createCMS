import type { CustomMediaConfig } from '../core/types/s3';

import {
  defineCollection,
  defineCollections,
  defineBlock,
} from '../index';

export const DUMMY_MEDIA_CONFIG: CustomMediaConfig = {
  provider: 'custom',
  hostname: '127.0.0.1:0',
  region: 'us-east-1',
  accessKeyId: 'dummy',
  secretAccessKey: 'dummy',
  bucketName: 'dummy',
  publicUrl: 'https://cdn.test.local',
  secure: false,
  forcePathStyle: true,
};

const hero = defineBlock({
  label: 'Hero',
  description: 'A hero section with background image and text',
  properties: {
    title: {
      type: 'string',
      label: 'Title',
      required: true,
    },
    backgroundImage: {
      type: 'image',
      label: 'Background Image',
    },
  },
});

export const pages = defineCollection({
  label: 'Pages',
  description: 'Website pages',
  slug: { enabled: true, root: '/pages' },
  root: {
    properties: {
      title: {
        type: 'string',
        label: 'Title',
        required: true,
      },
      description: {
        type: 'string',
        label: 'Description',
      },
    },
  },
  blocks: {
    hero,
    paragraph: {
      label: 'Paragraph',
      description: 'A block of text',
      properties: {
        text: {
          type: 'richText',
          label: 'Text',
          required: true,
        },
      },
      allowChildren: true,
    },
    image: {
      label: 'Image',
      description: 'An image with optional caption',
      properties: {
        src: {
          type: 'image',
          label: 'Source',
          required: true,
        },
        alt: {
          type: 'string',
          label: 'Alt text',
        },
      },
    },
    signupForm: {
      label: 'Signup Form',
      description: 'A functional form block',
      properties: {
        trackingId: {
          type: 'string',
          label: 'Tracking ID',
        },
        cta: {
          type: 'string',
          label: 'CTA',
          required: true,
        },
      },
      events: {
        submit: {},
        submitSuccess: {
          name: 'generate_lead',
        },
      },
    },
  },
});

export const TEST_COLLECTIONS = defineCollections({ pages });

import type { CustomMediaConfig } from '../../src/core/types/s3';

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

export const TEST_COLLECTIONS = {
  pages: {
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
      // A FUNCTIONAL block (declares events) — exercises the tracking-id guard.
      // `trackingId` is an ordinary (optional) string property here; its VALUE is
      // enforced at publish by the guard, not at create.
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
  },
} as const;

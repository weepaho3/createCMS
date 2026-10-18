import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AltDescribeInput } from '../index';

import { assets } from '../../../core/db/schema.generated';
import { setupTestCMS } from '../../../test-utils/cms';
import {
  chromeAltSuggester,
  type LanguageModelApi,
  serverAltSuggester,
} from '../client';
import { mediaAltAi } from '../index';
import { altPrompt, cleanAltSuggestion } from '../prompt';

describe('prompt and cleanup', () => {
  it('puts the block context into the prompt', () => {
    const prompt = altPrompt({
      pageTitle: 'Team',
      locale: 'de',
      linkTarget: '/about',
      surroundingText: 'Our office in Hamburg',
    });
    expect(prompt).toContain('The page is titled: Team');
    expect(prompt).toContain('Write in the language de.');
    expect(prompt).toContain('links to /about');
    expect(prompt).toContain('Our office in Hamburg');
  });

  it('keeps one clean sentence', () => {
    expect(
      cleanAltSuggestion('"Image of two people at a desk"\nMore text'),
    ).toBe('Two people at a desk');
    expect(cleanAltSuggestion('  ')).toBeNull();
    expect(cleanAltSuggestion('x'.repeat(400))!.length).toBe(250);
  });
});

describe('chromeAltSuggester', () => {
  function model(availability: string, answer = 'A red bicycle') {
    const prompt = vi.fn(async () => answer);
    const destroy = vi.fn();
    const api: LanguageModelApi = {
      availability: vi.fn(async () => availability) as never,
      create: vi.fn(async () => ({ prompt, destroy })),
    };
    return { api, prompt, destroy };
  }
  const fetchImage = vi.fn(
    async () => new Response(new Blob([new Uint8Array([1, 2, 3])])),
  );

  it('suggests with the on-device model and its image input', async () => {
    const { api, prompt, destroy } = model('available');
    const suggester = chromeAltSuggester({
      languageModel: api,
      fetch: fetchImage as unknown as typeof fetch,
    });
    expect(await suggester.available()).toBe(true);
    expect(
      await suggester.suggest({
        assetId: 'ast_1',
        context: { locale: 'de-DE' },
      }),
    ).toBe('A red bicycle');
    expect(fetchImage).toHaveBeenCalledWith(
      '/api/cms/media/asset/ast_1?w=640&format=webp',
      { credentials: 'include' },
    );
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOutputs: [{ type: 'text', languages: ['de'] }],
      }),
    );
    const [[messages]] = prompt.mock.calls as unknown as [
      [{ content: { type: string }[] }[]],
    ];
    expect(messages[0].content.map((c) => c.type)).toEqual(['text', 'image']);
    expect(destroy).toHaveBeenCalled();
  });

  it('is unavailable without the model on the device', async () => {
    for (const state of ['downloadable', 'downloading', 'unavailable']) {
      const { api } = model(state);
      const suggester = chromeAltSuggester({ languageModel: api });
      expect(await suggester.available()).toBe(false);
      expect(await suggester.suggest({ assetId: 'a', context: {} })).toBeNull();
      expect(api.create).not.toHaveBeenCalled();
    }
    expect(await chromeAltSuggester().available()).toBe(false);
  });

  it('wraps the server endpoint as a suggester', async () => {
    const call = vi.fn(async () => ({ alt: 'From the server' }));
    const suggester = serverAltSuggester(call);
    expect(await suggester.available()).toBe(true);
    expect(await suggester.suggest({ assetId: 'a', context: {} })).toBe(
      'From the server',
    );
  });
});

describe('mediaAltAi.suggestAlt', () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await cleanup?.();
    cleanup = undefined;
  });

  async function setup(
    describe: (input: AltDescribeInput) => Promise<string | null>,
  ) {
    const ctx = await setupTestCMS({
      withS3: true,
      plugins: [mediaAltAi({ describe, rateLimit: 2 })],
    });
    cleanup = ctx.s3.cleanup;
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const { assets } = await ctx.cms.api.media.uploadAssets({
      body: {
        files: [
          {
            name: 'desk.png',
            size: png.length,
            type: 'image/png',
            buffer: new Blob([png as BlobPart]),
          },
        ],
      },
    });
    // setupTestCMS takes untyped plugins, so the plugin namespace is typed here.
    const api = ctx.cms.api as unknown as {
      mediaAltAi: {
        suggestAlt(options: {
          body: { assetId: string; context?: Record<string, string> };
        }): Promise<{ alt: string | null }>;
      };
    };
    return { ...ctx, api, assetId: assets[0].id, png };
  }

  it('describes the image with the context and writes nothing', async () => {
    const describe = vi.fn(async () => '"Picture of a tidy desk"');
    const { api, db, assetId, png } = await setup(describe);
    const { alt } = await api.mediaAltAi.suggestAlt({
      body: { assetId, context: { pageTitle: 'Office', locale: 'en' } },
    });
    expect(alt).toBe('A tidy desk');
    const [[input]] = describe.mock.calls as unknown as [[AltDescribeInput]];
    expect(input.image).toEqual({ bytes: png, mimeType: 'image/png' });
    expect(input.prompt).toContain('The page is titled: Office');
    const [row] = await db
      .select({ metadata: assets.metadata, updatedAt: assets.updatedAt })
      .from(assets)
      .where(eq(assets.id, assetId));
    expect(row.metadata).toEqual({});
  });

  it('limits the rate, answers null on model errors and refuses unknown assets', async () => {
    const { api, assetId } = await setup(async () => {
      throw new Error('model down');
    });
    expect(await api.mediaAltAi.suggestAlt({ body: { assetId } })).toEqual({
      alt: null,
    });
    await expect(
      api.mediaAltAi.suggestAlt({
        body: { assetId: 'ast_00000000000000000000' },
      }),
    ).rejects.toMatchObject({ body: { code: 'ASSET_NOT_FOUND' } });
    await expect(
      api.mediaAltAi.suggestAlt({ body: { assetId } }),
    ).rejects.toMatchObject({ body: { code: 'RATE_LIMITED' } });
  });
});

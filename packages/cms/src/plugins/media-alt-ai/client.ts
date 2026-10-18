import type { AltContext } from './prompt';

import { altPrompt, cleanAltSuggestion } from './prompt';

export type { AltContext } from './prompt';
export { altPrompt, cleanAltSuggestion } from './prompt';

/**
 * Suggests alt text for an image (the shape `ImageField.Root` takes as
 * `suggesters`). `available` answers whether it can suggest at all; the
 * suggest button is left out when no suggester is available.
 */
export type AltSuggester = {
  suggest(input: {
    assetId: string;
    context: AltContext;
  }): Promise<string | null>;
  available(): Promise<boolean>;
};

type Availability =
  | 'unavailable'
  | 'downloadable'
  | 'downloading'
  | 'available';

type LanguageModelSession = {
  prompt(
    input: {
      role: 'user';
      content: (
        | { type: 'text'; value: string }
        | { type: 'image'; value: Blob }
      )[];
    }[],
  ): Promise<string>;
  destroy(): void;
};

/** Session options of the Prompt API: the modalities and languages used. */
export type LanguageModelOptions = {
  expectedInputs: { type: 'text' | 'image'; languages?: string[] }[];
  expectedOutputs: { type: 'text'; languages: string[] }[];
};

/** The parts of Chrome's `LanguageModel` (Prompt API) this adapter uses. */
export type LanguageModelApi = {
  availability(options: LanguageModelOptions): Promise<Availability>;
  create(options: LanguageModelOptions): Promise<LanguageModelSession>;
};

/** Output languages the Prompt API accepts. */
const PROMPT_LANGUAGES = ['en', 'de', 'es', 'fr', 'ja'] as const;

function outputLanguage(locale: string | undefined): string {
  const language = locale?.toLowerCase().split(/[-_]/)[0];
  return PROMPT_LANGUAGES.find((l) => l === language) ?? 'en';
}

export type ChromeAltSuggesterOptions = {
  /** URL of an image the model can read, default a 640 px WebP through the asset endpoint. */
  imageUrl?: (assetId: string) => string;
  /** The CMS base path for the default `imageUrl`. @default '/api/cms' */
  basePath?: string;
  /** Overrides `globalThis.LanguageModel` (tests). */
  languageModel?: LanguageModelApi;
  fetch?: typeof fetch;
};

/**
 * Alt text from the model built into Chrome (Prompt API with image input).
 * Available only when the model is already on the device (`available`),
 * so it never starts a multi-gigabyte download on its own; desktop Chrome
 * only, and not in workers.
 */
export function chromeAltSuggester(
  options: ChromeAltSuggesterOptions = {},
): AltSuggester {
  const basePath = (options.basePath ?? '/api/cms').replace(/\/+$/, '');
  const imageUrl =
    options.imageUrl ??
    ((assetId: string) =>
      `${basePath}/media/asset/${encodeURIComponent(assetId)}?w=640&format=webp`);
  const api = () =>
    options.languageModel ??
    (globalThis as { LanguageModel?: LanguageModelApi }).LanguageModel;
  const sessionOptions = (language: string): LanguageModelOptions => ({
    expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
    expectedOutputs: [{ type: 'text', languages: [language] }],
  });
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));

  return {
    async available() {
      const model = api();
      if (!model) return false;
      try {
        return (await model.availability(sessionOptions('en'))) === 'available';
      } catch {
        return false;
      }
    },
    async suggest({ assetId, context }) {
      const model = api();
      if (!model) return null;
      const language = outputLanguage(context.locale);
      if (
        (await model.availability(sessionOptions(language))) !== 'available'
      ) {
        return null;
      }
      const res = await doFetch(imageUrl(assetId), { credentials: 'include' });
      if (!res.ok) return null;
      const image = await res.blob();
      const session = await model.create(sessionOptions(language));
      try {
        const answer = await session.prompt([
          {
            role: 'user',
            content: [
              {
                type: 'text',
                value: altPrompt({ ...context, locale: language }),
              },
              { type: 'image', value: image },
            ],
          },
        ]);
        return cleanAltSuggestion(answer);
      } finally {
        session.destroy();
      }
    },
  };
}

/**
 * Alt text from the server's vision model through `mediaAltAi.suggestAlt`;
 * pass the client call, e.g.
 * `serverAltSuggester((body) => cms.mediaAltAi.suggestAlt({ body }))`.
 */
export function serverAltSuggester(
  call: (body: {
    assetId: string;
    context: AltContext;
  }) => Promise<{ alt: string | null }>,
): AltSuggester {
  return {
    available: async () => true,
    async suggest(input) {
      return (await call(input)).alt;
    },
  };
}

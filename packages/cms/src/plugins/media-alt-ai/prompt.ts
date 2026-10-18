/** Where an image sits, for a suggester describing it in its place. */
export type AltContext = {
  fieldType?: string;
  surroundingText?: string;
  pageTitle?: string;
  locale?: string;
  linkTarget?: string;
};

/** Longest suggestion kept; screen readers read alt text in one go. */
export const ALT_MAX_LENGTH = 250;

/** The instruction a vision model gets, with the block's context. */
export function altPrompt(context: AltContext = {}): string {
  const lines = [
    'Write the alt text for this image on a web page.',
    'Describe what matters for a reader who cannot see it, in one sentence of at most 125 characters.',
    'Do not start with "Image of" or "Picture of", do not use quotes, and answer with the alt text only.',
  ];
  if (context.locale) lines.push(`Write in the language ${context.locale}.`);
  if (context.pageTitle) lines.push(`The page is titled: ${context.pageTitle}`);
  if (context.fieldType)
    lines.push(`The image is used as: ${context.fieldType}`);
  if (context.linkTarget) {
    lines.push(
      `The image links to ${context.linkTarget}; say where the link goes.`,
    );
  }
  if (context.surroundingText) {
    lines.push(
      `Text around the image (do not repeat it): ${context.surroundingText.slice(0, 1000)}`,
    );
  }
  return lines.join('\n');
}

/**
 * A model answer as alt text: the first line, without wrapping quotes or an
 * "Image of" opening, at most `ALT_MAX_LENGTH` characters; `null` when
 * nothing is left.
 */
export function cleanAltSuggestion(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  let alt = text.trim().split(/\r?\n/)[0].trim();
  alt = alt.replace(/^["'“„‘]+|["'”’]+$/g, '').trim();
  alt = alt.replace(/^(an? )?(image|picture|photo) of\s+/i, '').trim();
  if (!alt) return null;
  if (alt.length > ALT_MAX_LENGTH) {
    alt = `${alt.slice(0, ALT_MAX_LENGTH - 1).trimEnd()}…`;
  }
  return alt.charAt(0).toUpperCase() + alt.slice(1);
}

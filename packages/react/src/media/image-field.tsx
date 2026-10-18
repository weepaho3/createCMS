import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type {
  AltState,
  AltSuggestAdapter,
  AltSuggestContext,
  ImageFieldValue,
  ImageRef,
} from './core/image-field';

import { mergeProps, useRender } from '../use-render';
import { useMediaAnnouncer, useMediaMessages } from './context';
import {
  acceptAltSuggestion,
  altStateOf,
  satisfiesAlt,
  setAlt,
  setCaption,
  setDecorative,
  canSuggestAlt,
  suggestAlt,
  toImageRef,
} from './core/image-field';

export type ImageFieldState = {
  value: ImageRef;
  altState: AltState;
  /** False while `requireAlt` is set and the alt text is missing. */
  valid: boolean;
  suggesting: boolean;
  onValueChange: (next: ImageRef) => void;
  suggest: () => Promise<void>;
  canSuggest: boolean;
};

const ImageFieldContext = React.createContext<ImageFieldState | null>(null);

/** The image field state of the enclosing `ImageField.Root`. */
export function useImageField(): ImageFieldState {
  const value = React.useContext(ImageFieldContext);
  if (!value)
    throw new Error('useImageField must be used within ImageField.Root.');
  return value;
}

export type ImageFieldRootProps = {
  /** The stored value: an asset id or a reference with alt text, caption and crop. */
  value: ImageFieldValue;
  onValueChange: (next: ImageRef) => void;
  /** The use needs alt text or "decorative" before it may be saved. */
  requireAlt?: boolean;
  /** Asked in order by `ImageField.SuggestAlt`; the first answer wins. */
  suggesters?: readonly AltSuggestAdapter[];
  /** What the suggesters get to describe the image in its place. */
  context?: AltSuggestContext;
  children?: React.ReactNode;
};

/**
 * The alt text, decorative switch and caption of one image use. They live
 * in the reference (`AssetRef`), so the same asset can carry different
 * alt text elsewhere. Renders no element.
 */
export function ImageFieldRoot(props: ImageFieldRootProps) {
  const {
    value,
    onValueChange,
    requireAlt = false,
    suggesters = [],
    context = {},
    children,
  } = props;
  const [suggesting, setSuggesting] = React.useState(false);
  // Read when a suggestion is asked for, so new arrays do not re-render.
  const latest = React.useRef({ value, onValueChange, suggesters, context });
  latest.current = { value, onValueChange, suggesters, context };
  const [canSuggest, setCanSuggest] = React.useState(false);
  React.useEffect(() => {
    let current = true;
    void canSuggestAlt(suggesters).then((available) => {
      if (current) setCanSuggest(available);
    });
    return () => {
      current = false;
    };
  }, [suggesters]);
  const state = React.useMemo<ImageFieldState>(() => {
    const ref = toImageRef(value);
    return {
      value: ref,
      altState: altStateOf(ref),
      valid: satisfiesAlt(ref, requireAlt),
      suggesting,
      onValueChange,
      canSuggest,
      suggest: async () => {
        setSuggesting(true);
        try {
          const text = await suggestAlt(latest.current.suggesters, {
            assetId: ref.assetId,
            context: latest.current.context,
          });
          // The person may have typed while the suggester ran.
          if (text) {
            latest.current.onValueChange(
              acceptAltSuggestion(latest.current.value, text),
            );
          }
        } finally {
          setSuggesting(false);
        }
      },
    };
  }, [value, requireAlt, suggesting, onValueChange, canSuggest]);
  return (
    <ImageFieldContext.Provider value={state}>
      {children}
    </ImageFieldContext.Provider>
  );
}

export type ImageFieldAltProps = UseRenderComponentProps<'textarea'>;

/**
 * A `textarea` for the alt text, `disabled` while decorative and
 * `aria-invalid` while required and missing. Typing marks the text as the
 * person's own (`altSource: 'user'`).
 */
export function ImageFieldAlt(props: ImageFieldAltProps) {
  const { render, ...rest } = props;
  const field = useImageField();
  const { messages } = useMediaMessages();
  return useRender({
    defaultTagName: 'textarea',
    render,
    props: mergeProps<'textarea'>(
      {
        'aria-label': messages.imageField.alt,
        'aria-invalid': !field.valid || undefined,
        value: field.value.alt ?? '',
        disabled: field.altState === 'decorative',
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
          field.onValueChange(setAlt(field.value, event.currentTarget.value)),
      },
      rest,
    ),
  });
}

export type ImageFieldDecorativeProps = UseRenderComponentProps<'input'>;

/** A checkbox: decorative images render `alt=""`; the typed text is kept. */
export function ImageFieldDecorative(props: ImageFieldDecorativeProps) {
  const { render, ...rest } = props;
  const field = useImageField();
  const { messages } = useMediaMessages();
  return useRender({
    defaultTagName: 'input',
    render,
    props: mergeProps<'input'>(
      {
        type: 'checkbox',
        'aria-label': messages.imageField.decorative,
        checked: field.altState === 'decorative',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          field.onValueChange(
            setDecorative(field.value, event.currentTarget.checked),
          ),
      },
      rest,
    ),
  });
}

export type ImageFieldCaptionProps = UseRenderComponentProps<'input'>;

/** An `input` for the visible caption of this use. */
export function ImageFieldCaption(props: ImageFieldCaptionProps) {
  const { render, ...rest } = props;
  const field = useImageField();
  const { messages } = useMediaMessages();
  return useRender({
    defaultTagName: 'input',
    render,
    props: mergeProps<'input'>(
      {
        'aria-label': messages.imageField.caption,
        value: field.value.caption ?? '',
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          field.onValueChange(
            setCaption(field.value, event.currentTarget.value),
          ),
      },
      rest,
    ),
  });
}

export type ImageFieldSuggestAltProps = UseRenderComponentProps<'button'>;

/**
 * A `button` that asks the suggesters for alt text. A suggestion only
 * fills an empty, non-decorative field and is marked as suggested until
 * the person edits it; `disabled` while the field has alt text. Not
 * rendered when no suggester is available (no model on the device, none
 * configured).
 */
export function ImageFieldSuggestAlt(props: ImageFieldSuggestAltProps) {
  const { render, ...rest } = props;
  const field = useImageField();
  const { messages } = useMediaMessages();
  const announce = useMediaAnnouncer();
  const element = useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'button',
        disabled: field.suggesting || field.altState !== 'missing',
        'aria-busy': field.suggesting || undefined,
        children: field.suggesting
          ? messages.imageField.suggesting
          : messages.imageField.suggest,
        onClick: () => {
          void field.suggest().then(() => {
            announce(messages.imageField.suggested);
          });
        },
      },
      rest,
    ),
  });
  return field.canSuggest ? element : null;
}

export type ImageFieldStatusProps = UseRenderComponentProps<'p'>;

/**
 * `imageField.missingAlt` while the alt text is missing, or
 * `imageField.suggested` while an accepted suggestion is unedited;
 * nothing otherwise.
 */
export function ImageFieldStatus(props: ImageFieldStatusProps) {
  const { render, ...rest } = props;
  const field = useImageField();
  const { messages } = useMediaMessages();
  const text =
    field.altState === 'missing'
      ? messages.imageField.missingAlt
      : field.value.altSource === 'ai-suggested' && field.altState === 'present'
        ? messages.imageField.suggested
        : null;
  const element = useRender({
    defaultTagName: 'p',
    render,
    props: mergeProps<'p'>(
      {
        children: text,
        'data-alt-state': field.altState,
      },
      rest,
    ),
  });
  return text ? element : null;
}

// @registry ui-sdk-editor@0.3.2
'use client';

import type { RichTextToolbarState } from '@createcms/react/editor';
import type { LinkValue } from '@createcms/react/editor/core';

import { isSafeUrl } from '@createcms/react/editor/core';
import { Button } from '@ui-sdk/react/button';
import { Field, FieldError, FieldLabel } from '@ui-sdk/react/field';
import { Input } from '@ui-sdk/react/input';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@ui-sdk/react/popover';
import { Toggle, ToggleGroup } from '@ui-sdk/react/toggle';
import { LinkIcon } from 'lucide-react';
import * as React from 'react';

type Kind = LinkValue['kind'];

export type PagePickerProps = {
  collection: string;
  value: string | undefined;
  onChange: (rootId: string) => void;
  label: string;
};

export type RichTextLinks = {
  collections: readonly string[];
  renderPagePicker: (props: PagePickerProps) => React.ReactNode;
};

const LinksContext = React.createContext<RichTextLinks | null>(null);

export function RichTextLinksProvider({
  value,
  children,
}: {
  value: RichTextLinks;
  children: React.ReactNode;
}) {
  return <LinksContext value={value}>{children}</LinksContext>;
}

const KIND_LABEL: Record<Kind, string> = {
  internal: 'Page',
  external: 'URL',
  email: 'Email',
  phone: 'Phone',
};

type Draft = {
  kind: Kind;
  url: string;
  email: string;
  phone: string;
  collection: string;
  rootId: string;
};

function draftOf(
  current: LinkValue | { kind: 'href'; href: string } | null,
  kinds: readonly Kind[],
  collections: readonly string[],
): Draft {
  const draft: Draft = {
    kind: kinds.includes('external') ? 'external' : kinds[0]!,
    url: '',
    email: '',
    phone: '',
    collection: collections[0] ?? '',
    rootId: '',
  };
  if (!current) return draft;
  if (current.kind === 'href')
    return { ...draft, kind: 'external', url: current.href };
  if (current.kind === 'external')
    return { ...draft, kind: 'external', url: current.url };
  if (current.kind === 'email')
    return { ...draft, kind: 'email', email: current.email };
  if (current.kind === 'phone')
    return { ...draft, kind: 'phone', phone: current.phone };
  return {
    ...draft,
    kind: 'internal',
    collection: current.collection,
    rootId: current.rootId,
  };
}

function valueOf(draft: Draft): LinkValue | string {
  switch (draft.kind) {
    case 'external': {
      const url = draft.url.trim();
      if (!url) return 'Enter a URL.';
      if (!isSafeUrl(url)) return 'Use an http, https, mailto or tel address.';
      return { kind: 'external', url };
    }
    case 'email': {
      const email = draft.email.trim();
      return email.includes('@')
        ? { kind: 'email', email }
        : 'Enter an email address.';
    }
    case 'phone': {
      const phone = draft.phone.trim();
      return phone ? { kind: 'phone', phone } : 'Enter a phone number.';
    }
    case 'internal':
      return draft.rootId
        ? {
            kind: 'internal',
            collection: draft.collection,
            rootId: draft.rootId,
          }
        : 'Choose a page.';
  }
}

function LinkForm({
  state,
  name,
  onDone,
}: {
  state: RichTextToolbarState;
  name: string;
  onDone: () => void;
}) {
  const links = React.useContext(LinksContext);
  const kinds: Kind[] = links
    ? ['internal', 'external', 'email', 'phone']
    : ['external', 'email', 'phone'];
  const collections = links?.collections ?? [];
  const current = state.handle?.commands.getLink?.() ?? null;
  const [draft, setDraft] = React.useState(() =>
    draftOf(current, kinds, collections),
  );
  const [error, setError] = React.useState<string | null>(null);
  const set = (patch: Partial<Draft>) => {
    setError(null);
    setDraft((prev) => ({ ...prev, ...patch }));
  };
  const text = (
    key: 'url' | 'email' | 'phone',
    label: string,
    type: string,
  ) => (
    <Field className="ed-field" invalid={error !== null}>
      <FieldLabel className="ed-label">{label}</FieldLabel>
      <Input
        type={type}
        className="ed-input"
        value={draft[key]}
        onValueChange={(value) => set({ [key]: value })}
      />
      {error ? (
        <FieldError match className="ed-error">
          {error}
        </FieldError>
      ) : null}
    </Field>
  );

  return (
    <form
      className="ed-stack"
      onSubmit={(event) => {
        event.preventDefault();
        const value = valueOf(draft);
        if (typeof value === 'string') {
          setError(value);
          return;
        }
        state.handle?.commands.setLink(value);
        onDone();
      }}
    >
      <ToggleGroup
        aria-label="Link type"
        value={[draft.kind]}
        deselectable={false}
        onValueChange={(value) => {
          const kind = value[0] as Kind | undefined;
          if (kind) set({ kind });
        }}
        className="ed-segmented"
      >
        {kinds.map((kind) => (
          <Toggle key={kind} value={kind}>
            {KIND_LABEL[kind]}
          </Toggle>
        ))}
      </ToggleGroup>
      {draft.kind === 'external'
        ? text('url', `${name} link URL`.trim(), 'url')
        : null}
      {draft.kind === 'email'
        ? text('email', `${name} link email`.trim(), 'email')
        : null}
      {draft.kind === 'phone'
        ? text('phone', `${name} link phone`.trim(), 'tel')
        : null}
      {draft.kind === 'internal' && links ? (
        <>
          {links.collections.length > 1 ? (
            <ToggleGroup
              aria-label="Collection"
              value={[draft.collection]}
              deselectable={false}
              onValueChange={(value) => {
                if (value[0]) set({ collection: value[0], rootId: '' });
              }}
              className="ed-segmented"
            >
              {links.collections.map((collection) => (
                <Toggle key={collection} value={collection}>
                  {collection}
                </Toggle>
              ))}
            </ToggleGroup>
          ) : null}
          <div className="ed-field">
            {links.renderPagePicker({
              collection: draft.collection,
              value: draft.rootId || undefined,
              onChange: (rootId) => set({ rootId }),
              label: `${name} link page`.trim(),
            })}
            {error ? (
              <p role="alert" className="ed-error">
                {error}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
      <div className="ed-actions">
        {current ? (
          <Button
            className="ed-button"
            data-variant="outline"
            onClick={() => {
              state.handle?.commands.setLink(null);
              onDone();
            }}
          >
            Remove link
          </Button>
        ) : null}
        <Button type="submit" className="ed-button" data-variant="primary">
          Apply link
        </Button>
      </div>
    </form>
  );
}

export function LinkControl({
  state,
  name = '',
}: {
  state: RichTextToolbarState;
  name?: string;
}) {
  const [open, setOpen] = React.useState(false);
  if (!state.schema.marks.includes('link')) return null;
  void state.selectionVersion;
  const active = state.handle?.commands.isActive('link') ?? false;
  const label = `Link ${name}`.trim();
  return (
    <Popover open={open} onOpenChange={(next) => setOpen(next)}>
      <PopoverTrigger
        render={<Toggle pressed={active || open} />}
        aria-label={label}
        title="Link"
        disabled={!state.editable || !state.handle}
        className="ed-format"
        onPointerDown={(event) => event.preventDefault()}
      >
        <LinkIcon aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        sideOffset={6}
        container={open ? document.body : null}
        data-editor-inline-chrome=""
        className="ed-popup ed-link-popup"
      >
        <PopoverTitle className="ed-dialog-title">
          {active ? 'Edit link' : 'Add link'}
        </PopoverTitle>
        {open ? (
          <LinkForm state={state} name={name} onDone={() => setOpen(false)} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

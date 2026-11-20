// @registry ui-sdk-editor-createcms@0.3.2
'use client';

import type { FieldControlProps, FieldControls } from '@createcms/react/editor';
import type {
  CmsFieldSources,
  CmsRootListItem,
} from '@createcms/react/editor/cms';
import type { MediaClient } from '@createcms/react/media';

import {
  assetUrl,
  referenceLabel,
  useVariableSuggest,
} from '@createcms/react/editor/cms';
import { useAsyncOptions } from '@ui-sdk/react/async-options';
import { Button } from '@ui-sdk/react/button';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxList,
  ComboboxStatus,
  ComboboxTrigger,
} from '@ui-sdk/react/combobox';
import { useFieldControl } from '@ui-sdk/react/field';
import { Input } from '@ui-sdk/react/input';
import { CheckIcon, ChevronsUpDownIcon } from 'lucide-react';
import * as React from 'react';

import { MediaPicker } from '../media-picker';
import { Choice, RichTextField, fields } from './fields';

type Sources = { sources: CmsFieldSources; media: MediaClient | undefined };

const SourcesContext = React.createContext<Sources | null>(null);

export function CmsSourcesProvider({
  sources,
  media,
  children,
}: {
  sources: CmsFieldSources;
  media?: MediaClient;
  children: React.ReactNode;
}) {
  const value = React.useMemo(() => ({ sources, media }), [sources, media]);
  return <SourcesContext value={value}>{children}</SourcesContext>;
}

function useSources(): Sources {
  const value = React.useContext(SourcesContext);
  if (!value) throw new Error('CmsSourcesProvider is required for cms fields');
  return value;
}

const UNSUPPORTED = 'Not supported by this media source';

export function sourcesMediaClient(sources: CmsFieldSources): MediaClient {
  const reject = () => Promise.reject(new Error(UNSUPPORTED));
  return {
    async listAssets(args) {
      const query = args?.query;
      const offset = Number(query?.cursor ?? 0);
      const page = await sources.assets.list({
        search: query?.search,
        limit: query?.limit,
        offset,
      });
      return {
        assets: page.assets,
        total: page.total,
        hasMore: page.hasMore,
        nextCursor: page.hasMore ? String(offset + page.assets.length) : null,
      };
    },
    listFolders: async () => ({ folders: [] }),
    createFolder: reject,
    moveAssets: reject,
    archiveAssets: reject,
    updateAssetsStatus: reject,
    useUploadAssets: () => sources.assets.useUpload(),
  };
}

const PAGE = 20;

function rootLabel(root: CmsRootListItem): string {
  const props = root.properties ?? {};
  for (const key of ['title', 'label', 'name'] as const) {
    const value = props[key];
    if (typeof value === 'string' && value) return value;
  }
  return root.slug || root.path || root.id;
}

function RootCombobox({
  collection,
  value,
  onChange,
  disabled,
  readOnly,
  label,
  id,
}: {
  collection: string;
  value: string | undefined;
  onChange: (rootId: string) => void;
  disabled: boolean;
  readOnly?: boolean;
  label: string;
  id?: string;
}) {
  const inField = useFieldControl() !== null;
  const { sources } = useSources();
  const [current, setCurrent] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!value) {
      setCurrent(null);
      return;
    }
    let live = true;
    void referenceLabel(collection, value, sources).then((text) => {
      if (live) setCurrent(text);
    });
    return () => {
      live = false;
    };
  }, [collection, value, sources]);
  const roots = useAsyncOptions(
    async (query, { page }) => {
      const result = await sources.roots.list(collection, {
        search: query || undefined,
        limit: PAGE,
        offset: page * PAGE,
      });
      return {
        items: result.roots.map((root) => ({
          value: root.id,
          label: rootLabel(root),
        })),
        hasMore: result.hasMore,
      };
    },
    { immediate: true },
  );
  return (
    <Combobox
      value={value ?? null}
      items={roots.items}
      filter={false}
      status={roots.status}
      disabled={disabled}
      readOnly={readOnly}
      itemToLabel={(id) => (id === value ? (current ?? id) : id)}
      onQueryChange={(query) => roots.setQuery(query)}
      onLoadMore={roots.loadMore}
      onValueChange={(next) => {
        if (typeof next === 'string') onChange(next);
      }}
    >
      <div className="ed-input ed-combobox">
        <ComboboxInput
          id={id}
          aria-label={inField ? undefined : label}
          placeholder="Type to search"
        />
        <ComboboxTrigger aria-label={`Show ${label.toLowerCase()} options`}>
          <ChevronsUpDownIcon aria-hidden />
        </ComboboxTrigger>
      </div>
      <ComboboxContent sideOffset={4} className="ed-popup ed-list">
        <ComboboxStatus className="ed-status-line">
          {(state) =>
            state.status === 'error'
              ? 'Could not load.'
              : state.loading
                ? 'Searching…'
                : `${state.count} ${state.count === 1 ? 'result' : 'results'}`
          }
        </ComboboxStatus>
        <ComboboxEmpty className="ed-empty">
          {(state) => (state.empty && !state.loading ? 'Nothing found.' : null)}
        </ComboboxEmpty>
        <ComboboxList>
          {(state) =>
            (state.items as { value: string; label: string }[]).map((item) => (
              <ComboboxItem
                key={item.value}
                value={item.value}
                label={item.label}
                className="ed-item"
              >
                {item.label}
                <ComboboxItemIndicator className="ed-item-end">
                  <CheckIcon />
                </ComboboxItemIndicator>
              </ComboboxItem>
            ))
          }
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function MediaField(props: FieldControlProps<'media'>) {
  const { sources, media } = useSources();
  const fallback = React.useMemo(() => sourcesMediaClient(sources), [sources]);
  const assetId = props.value?.assetId;
  const locked = props.disabled || props.readOnly;
  return (
    <div className="ed-stack">
      {assetId ? (
        <img src={assetUrl(assetId)} alt="" className="ed-asset" />
      ) : null}
      <div className="ed-row">
        <MediaPicker
          client={media ?? fallback}
          value={assetId}
          accept={props.spec.accept?.join(',') ?? 'image/*'}
          disabled={locked}
          onChange={(next) => {
            if (!next) return props.onChange(undefined);
            // A revision pin belongs to the old asset; alt, caption and crop carry over.
            const { revisionId: _pinned, ...kept } = props.value ?? {
              assetId: next,
            };
            props.onChange({ ...kept, assetId: next });
          }}
          trigger={
            <Button
              className="ed-button"
              data-variant="outline"
              disabled={locked}
            >
              {assetId ? 'Change' : 'Choose'} {props.spec.label ?? 'image'}
            </Button>
          }
        />
        {assetId ? (
          <Button
            className="ed-button"
            data-variant="ghost"
            disabled={locked}
            onClick={() => props.onChange(undefined)}
          >
            Clear {props.spec.label ?? 'image'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ReferenceField(props: FieldControlProps<'reference'>) {
  return (
    <RootCombobox
      id={props.id}
      label={props.spec.label ?? 'Reference'}
      collection={props.spec.collection}
      value={props.value?.id}
      disabled={props.disabled}
      readOnly={props.readOnly}
      onChange={(id) => props.onChange({ id })}
    />
  );
}

const KINDS = ['internal', 'external', 'email', 'phone'] as const;
type Kind = (typeof KINDS)[number];
const KIND_LABEL: Record<Kind, string> = {
  internal: 'Page',
  external: 'URL',
  email: 'Email',
  phone: 'Phone',
};

function LinkField(props: FieldControlProps<'link'>) {
  const fieldLabel = props.spec.label ?? 'Link';
  const allowed = props.spec.allowedKinds ?? [...KINDS];
  const link = props.value;
  const kind: Kind = link?.kind ?? allowed[0] ?? 'external';
  const collections = props.spec.allowedCollections ?? [];
  const collection =
    link?.kind === 'internal' ? link.collection : (collections[0] ?? '');
  const rootId = link?.kind === 'internal' ? link.rootId : '';
  const empty: Record<Kind, NonNullable<typeof link>> = {
    internal: {
      kind: 'internal',
      rootId: '',
      collection: collections[0] ?? '',
    },
    external: { kind: 'external', url: '' },
    email: { kind: 'email', email: '' },
    phone: { kind: 'phone', phone: '' },
  };
  const text = (
    type: string,
    label: string,
    value: string,
    set: (v: string) => void,
  ) => (
    <Input
      type={type}
      aria-label={`${fieldLabel} ${label.toLowerCase()}`}
      className="ed-input"
      disabled={props.disabled}
      readOnly={props.readOnly}
      value={value}
      onValueChange={set}
    />
  );
  return (
    <div className="ed-stack">
      <Choice
        aria-label={`${fieldLabel} link type`}
        value={kind}
        disabled={props.disabled}
        readOnly={props.readOnly}
        options={allowed.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
        onValueChange={(next) => props.onChange(empty[next as Kind])}
      />
      {kind === 'internal' ? (
        <>
          {collections.length > 1 ? (
            <Choice
              aria-label={`${fieldLabel} collection`}
              value={collection}
              disabled={props.disabled}
              readOnly={props.readOnly}
              options={collections.map((c) => ({ value: c, label: c }))}
              onValueChange={(next) =>
                props.onChange({ kind: 'internal', rootId, collection: next })
              }
            />
          ) : collections.length === 0 ? (
            text('text', 'Collection', collection, (next) =>
              props.onChange({ kind: 'internal', rootId, collection: next }),
            )
          ) : null}
          {collection ? (
            <RootCombobox
              label={`${fieldLabel} page`}
              collection={collection}
              value={rootId || undefined}
              disabled={props.disabled}
              readOnly={props.readOnly}
              onChange={(id) =>
                props.onChange({ kind: 'internal', rootId: id, collection })
              }
            />
          ) : null}
        </>
      ) : null}
      {link?.kind === 'external' || (!link && kind === 'external')
        ? text('url', 'URL', link?.kind === 'external' ? link.url : '', (url) =>
            props.onChange({ kind: 'external', url }),
          )
        : null}
      {kind === 'email'
        ? text(
            'email',
            'Email',
            link?.kind === 'email' ? link.email : '',
            (email) => props.onChange({ kind: 'email', email }),
          )
        : null}
      {kind === 'phone'
        ? text(
            'tel',
            'Phone',
            link?.kind === 'phone' ? link.phone : '',
            (phone) => props.onChange({ kind: 'phone', phone }),
          )
        : null}
    </div>
  );
}

function CmsRichTextField(props: FieldControlProps<'richText'>) {
  const suggest = useVariableSuggest(useSources().sources);
  const items = React.useCallback(
    (query: string) =>
      suggest.getItems(query).map((item) => ({
        label: typeof item.key === 'string' ? item.key : item.insertText,
        insertText: item.insertText,
        description:
          typeof item.description === 'string' ? item.description : undefined,
      })),
    [suggest],
  );
  return <RichTextField {...props} suggest={{ items }} />;
}

export const cmsFields = {
  ...fields,
  media: MediaField,
  reference: ReferenceField,
  link: LinkField,
  richText: CmsRichTextField,
} satisfies FieldControls;

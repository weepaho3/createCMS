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
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { RichTextField, fieldAria, fieldControls } from './editor-field';
import { MediaPicker } from './media-picker';

type CmsSourcesContextValue = {
  sources: CmsFieldSources;
  media: MediaClient | undefined;
};

const CmsSourcesContext = React.createContext<CmsSourcesContextValue | null>(
  null,
);

export function CmsSourcesProvider({
  sources,
  media,
  children,
}: {
  sources: CmsFieldSources;
  /** Full media client for the picker; without one the picker reads through `sources.assets`. */
  media?: MediaClient;
  children: React.ReactNode;
}) {
  const value = React.useMemo(() => ({ sources, media }), [sources, media]);
  return (
    <CmsSourcesContext.Provider value={value}>
      {children}
    </CmsSourcesContext.Provider>
  );
}

function useCmsSourcesContext(): CmsSourcesContextValue {
  const value = React.useContext(CmsSourcesContext);
  if (!value) {
    throw new Error('CmsSourcesProvider is required for cms field controls');
  }
  return value;
}

function useCmsSources(): CmsFieldSources {
  return useCmsSourcesContext().sources;
}

const UNSUPPORTED = 'Not supported by this media source';

/**
 * Read-only `MediaClient` over `CmsFieldSources`: offset paging as the
 * cursor, no folders, uploads through `sources.assets.useUpload`; every
 * mutation rejects.
 */
export function sourcesMediaClient(sources: CmsFieldSources): MediaClient {
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
    async listFolders() {
      return { folders: [] };
    },
    createFolder: () => Promise.reject(new Error(UNSUPPORTED)),
    moveAssets: () => Promise.reject(new Error(UNSUPPORTED)),
    archiveAssets: () => Promise.reject(new Error(UNSUPPORTED)),
    updateAssetsStatus: () => Promise.reject(new Error(UNSUPPORTED)),
    useUploadAssets: () => sources.assets.useUpload(),
  };
}

const PAGE_SIZE = 20;

function labelFromRoot(root: CmsRootListItem): string {
  const props = root.properties ?? {};
  for (const key of ['title', 'label', 'name'] as const) {
    const value = props[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  if (root.slug) return root.slug;
  if (root.path) return root.path;
  return root.id;
}

function RootPickerDialog({
  collection,
  value,
  onSelect,
  disabled,
  triggerLabel,
}: {
  collection: string;
  value: string | undefined;
  onSelect: (rootId: string) => void;
  disabled: boolean;
  triggerLabel: string;
}) {
  const sources = useCmsSources();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const [roots, setRoots] = React.useState<CmsRootListItem[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [label, setLabel] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!value) {
      setLabel(null);
      return;
    }
    let cancelled = false;
    void referenceLabel(collection, value, sources).then((text) => {
      if (!cancelled) setLabel(text);
    });
    return () => {
      cancelled = true;
    };
  }, [collection, sources, value]);

  const load = React.useCallback(async () => {
    const page = await sources.roots.list(collection, {
      search: search || undefined,
      limit: PAGE_SIZE,
      offset,
    });
    setRoots(page.roots);
    setHasMore(page.hasMore);
  }, [collection, offset, search, sources.roots]);

  React.useEffect(() => {
    if (!open) return;
    void load();
  }, [load, open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className="w-full justify-start font-normal"
          >
            {value ? (label ?? value) : triggerLabel}
          </Button>
        }
      />
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{triggerLabel}</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
        />
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {roots.map((root) => (
            <li key={root.id}>
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  onSelect(root.id);
                  setOpen(false);
                }}
              >
                {labelFromRoot(root)}
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset((prev) => Math.max(0, prev - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasMore}
            onClick={() => setOffset((prev) => prev + PAGE_SIZE)}
          >
            Next
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MediaField(props: FieldControlProps<'media'>) {
  const { sources, media } = useCmsSourcesContext();
  const adapter = React.useMemo(() => sourcesMediaClient(sources), [sources]);
  const assetId = props.value?.assetId;
  const previewUrl = assetId ? assetUrl(assetId) : null;
  const locked = props.disabled || props.readOnly;

  return (
    <div id={props.id} className="flex flex-col gap-2" {...fieldAria(props)}>
      {previewUrl ? (
        <img
          src={previewUrl}
          alt=""
          className="max-h-32 w-auto rounded-md border object-contain"
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <MediaPicker
          client={media ?? adapter}
          value={assetId}
          onChange={(next) => {
            if (!next) {
              props.onChange(undefined);
              return;
            }
            // A revision pin belongs to the previous asset; the rest of the
            // settings (alt, caption, crop, ...) carry over to the new one.
            const { revisionId: _pinned, ...kept } = props.value ?? {
              assetId: next,
            };
            props.onChange({ ...kept, assetId: next });
          }}
          accept={props.spec.accept?.join(',') ?? 'image/*'}
          disabled={locked}
          trigger={
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              aria-describedby={props.describedBy}
              aria-invalid={props.invalid || undefined}
              aria-required={props.required || undefined}
            >
              {assetId ? 'Change image' : 'Choose image'}
            </Button>
          }
        />
        {assetId ? (
          <Button
            type="button"
            variant="ghost"
            disabled={locked}
            onClick={() => props.onChange(undefined)}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ReferencePicker(props: FieldControlProps<'reference'>) {
  return (
    <div id={props.id} className="flex flex-col gap-2" {...fieldAria(props)}>
      <RootPickerDialog
        collection={props.spec.collection}
        value={props.value?.id}
        disabled={props.disabled || props.readOnly}
        triggerLabel="Select reference"
        onSelect={(rootId) => props.onChange({ id: rootId })}
      />
    </div>
  );
}

const LINK_KINDS = ['internal', 'external', 'email', 'phone'] as const;

function LinkField(props: FieldControlProps<'link'>) {
  const allowed = props.spec.allowedKinds ?? [...LINK_KINDS];
  const kind = props.value?.kind ?? allowed[0] ?? 'external';
  const collections = props.spec.allowedCollections ?? [];

  const setKind = (next: (typeof LINK_KINDS)[number]) => {
    switch (next) {
      case 'internal':
        props.onChange({
          kind: 'internal',
          rootId: '',
          collection: collections[0] ?? '',
        });
        break;
      case 'external':
        props.onChange({ kind: 'external', url: '' });
        break;
      case 'email':
        props.onChange({ kind: 'email', email: '' });
        break;
      case 'phone':
        props.onChange({ kind: 'phone', phone: '' });
        break;
    }
  };

  return (
    <div id={props.id} className="flex flex-col gap-2" {...fieldAria(props)}>
      <Select
        value={kind}
        disabled={props.disabled}
        onValueChange={(value) => {
          if (value === null) return;
          setKind(value as (typeof LINK_KINDS)[number]);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowed.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {kind === 'internal' ? (
        <div className="flex flex-col gap-2">
          {collections.length > 1 ? (
            <Select
              value={
                props.value?.kind === 'internal'
                  ? props.value.collection
                  : (collections[0] ?? null)
              }
              disabled={props.disabled}
              onValueChange={(value) => {
                if (value === null) return;
                const rootId =
                  props.value?.kind === 'internal' ? props.value.rootId : '';
                props.onChange({
                  kind: 'internal',
                  rootId,
                  collection: value,
                });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {collections.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : collections.length === 0 ? (
            <Input
              placeholder="Collection"
              disabled={props.disabled}
              value={
                props.value?.kind === 'internal' ? props.value.collection : ''
              }
              onChange={(event) => {
                const rootId =
                  props.value?.kind === 'internal' ? props.value.rootId : '';
                props.onChange({
                  kind: 'internal',
                  rootId,
                  collection: event.target.value,
                });
              }}
            />
          ) : null}
          <RootPickerDialog
            collection={
              props.value?.kind === 'internal'
                ? props.value.collection
                : (collections[0] ?? '')
            }
            value={
              props.value?.kind === 'internal' ? props.value.rootId : undefined
            }
            disabled={props.disabled}
            triggerLabel="Select page"
            onSelect={(rootId) => {
              const col =
                props.value?.kind === 'internal'
                  ? props.value.collection
                  : (collections[0] ?? '');
              props.onChange({ kind: 'internal', rootId, collection: col });
            }}
          />
        </div>
      ) : null}
      {kind === 'external' ? (
        <Input
          placeholder="https://"
          disabled={props.disabled}
          value={props.value?.kind === 'external' ? props.value.url : ''}
          onChange={(event) =>
            props.onChange({ kind: 'external', url: event.target.value })
          }
        />
      ) : null}
      {kind === 'email' ? (
        <Input
          type="email"
          placeholder="name@example.com"
          disabled={props.disabled}
          value={props.value?.kind === 'email' ? props.value.email : ''}
          onChange={(event) =>
            props.onChange({ kind: 'email', email: event.target.value })
          }
        />
      ) : null}
      {kind === 'phone' ? (
        <Input
          type="tel"
          placeholder="+1 555 0100"
          disabled={props.disabled}
          value={props.value?.kind === 'phone' ? props.value.phone : ''}
          onChange={(event) =>
            props.onChange({ kind: 'phone', phone: event.target.value })
          }
        />
      ) : null}
    </div>
  );
}

/** Rich text with `{{variable}}` completion from the CMS variables. */
function CmsRichTextField(props: FieldControlProps<'richText'>) {
  const sources = useCmsSources();
  const suggest = useVariableSuggest(sources);
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

/** `fieldControls` plus the createCMS controls (media, references, links, variables). */
export const cmsFields = {
  ...fieldControls,
  media: MediaField,
  reference: ReferencePicker,
  link: LinkField,
  richText: CmsRichTextField,
} satisfies FieldControls;

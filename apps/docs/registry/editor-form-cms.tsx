'use client';

import type { FieldControlProps, FieldControls } from '@createcms/react/editor';
import type {
  CmsAssetListItem,
  CmsFieldSources,
  CmsRootListItem,
} from '@createcms/react/editor/cms';

import { emptyListElement } from '@createcms/react/editor';
import {
  assetUrl,
  referenceLabel,
  useVariableSuggest,
} from '@createcms/react/editor/cms';
import * as React from 'react';
import { createPortal } from 'react-dom';

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

const CmsSourcesContext = React.createContext<CmsFieldSources | null>(null);

export function CmsSourcesProvider({
  sources,
  children,
}: {
  sources: CmsFieldSources;
  children: React.ReactNode;
}) {
  return (
    <CmsSourcesContext.Provider value={sources}>
      {children}
    </CmsSourcesContext.Provider>
  );
}

function useCmsSources(): CmsFieldSources {
  const value = React.useContext(CmsSourcesContext);
  if (!value) {
    throw new Error('CmsSourcesProvider is required for cms field controls');
  }
  return value;
}

function fieldAria(props: {
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
}) {
  return {
    'aria-describedby': props.describedBy,
    'aria-invalid': props.invalid || undefined,
    'aria-required': props.required || undefined,
  } as const;
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

function MediaField(props: FieldControlProps<'image'>) {
  const sources = useCmsSources();
  const upload = sources.assets.useUpload();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const expectingUploadRef = React.useRef(false);
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const [assets, setAssets] = React.useState<CmsAssetListItem[]>([]);
  const [hasMore, setHasMore] = React.useState(false);

  const loadAssets = React.useCallback(async () => {
    const page = await sources.assets.list({
      search: search || undefined,
      limit: PAGE_SIZE,
      offset,
    });
    setAssets(page.assets);
    setHasMore(page.hasMore);
  }, [offset, search, sources.assets]);

  React.useEffect(() => {
    if (!open) return;
    void loadAssets();
  }, [loadAssets, open]);

  React.useEffect(() => {
    if (!expectingUploadRef.current || upload.isUploading) return;

    expectingUploadRef.current = false;
    if (upload.error) return;

    const uploaded = upload.files.find((file) => file.result?.id);
    if (uploaded?.result?.id) {
      props.onChange(uploaded.result.id);
      void loadAssets();
    }
  }, [
    loadAssets,
    props.onChange,
    upload.error,
    upload.files,
    upload.isUploading,
  ]);

  const previewUrl = props.value ? assetUrl(props.value) : null;

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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button
                type="button"
                variant="outline"
                disabled={props.disabled}
                aria-describedby={props.describedBy}
                aria-invalid={props.invalid || undefined}
                aria-required={props.required || undefined}
              >
                {props.value ? 'Change image' : 'Select image'}
              </Button>
            }
          />
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Select image</DialogTitle>
            </DialogHeader>
            <Input
              placeholder="Search assets"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setOffset(0);
              }}
            />
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {assets.map((asset) => (
                <li key={asset.id}>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-start"
                    onClick={() => {
                      props.onChange(asset.id);
                      setOpen(false);
                    }}
                  >
                    {asset.slug || asset.id}
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
                onClick={() =>
                  setOffset((prev) => Math.max(0, prev - PAGE_SIZE))
                }
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
        <Button
          type="button"
          variant="outline"
          disabled={props.disabled || upload.isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {upload.isUploading ? 'Uploading…' : 'Upload'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={props.disabled || upload.isUploading}
          onChange={(event) => {
            const files = event.target.files;
            if (!files?.length) return;
            expectingUploadRef.current = true;
            void upload.upload(Array.from(files));
            event.target.value = '';
          }}
        />
        {props.value ? (
          <Button
            type="button"
            variant="ghost"
            disabled={props.disabled}
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
        value={props.value}
        disabled={props.disabled}
        triggerLabel="Select reference"
        onSelect={(rootId) => props.onChange(rootId)}
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
      <select
        className="border-input bg-background rounded-md border px-3 py-2 text-sm"
        value={kind}
        disabled={props.disabled}
        onChange={(event) =>
          setKind(event.target.value as (typeof LINK_KINDS)[number])
        }
      >
        {allowed.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      {kind === 'internal' ? (
        <div className="flex flex-col gap-2">
          {collections.length > 1 ? (
            <select
              className="border-input bg-background rounded-md border px-3 py-2 text-sm"
              value={
                props.value?.kind === 'internal'
                  ? props.value.collection
                  : collections[0]
              }
              disabled={props.disabled}
              onChange={(event) => {
                const rootId =
                  props.value?.kind === 'internal' ? props.value.rootId : '';
                props.onChange({
                  kind: 'internal',
                  rootId,
                  collection: event.target.value,
                });
              }}
            >
              {collections.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
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

function RichTextField(props: FieldControlProps<'richText'>) {
  const sources = useCmsSources();
  const suggest = useVariableSuggest(sources);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [highlighted, setHighlighted] = React.useState(0);
  const [suggestOpen, setSuggestOpen] = React.useState(false);
  const [suggestQuery, setSuggestQuery] = React.useState('');
  const [suggestRect, setSuggestRect] = React.useState<DOMRect | null>(null);

  const items = suggestOpen ? suggest.getItems(suggestQuery) : [];

  const updateSuggest = (text: string, caret: number) => {
    const prefix = text.slice(0, caret);
    const match = prefix.match(suggest.pattern);
    if (!match) {
      setSuggestOpen(false);
      return;
    }
    setSuggestQuery(match[1] ?? '');
    setSuggestOpen(true);
    setHighlighted(0);
    const textarea = textareaRef.current;
    if (textarea) {
      setSuggestRect(textarea.getBoundingClientRect());
    }
  };

  const accept = (index: number) => {
    const item = items[index];
    const textarea = textareaRef.current;
    if (!item || !textarea) return;
    const caret = textarea.selectionStart;
    const text = props.value ?? '';
    const prefix = text.slice(0, caret);
    const match = prefix.match(suggest.pattern);
    if (!match) return;
    const start = caret - match[0].length;
    const next = text.slice(0, start) + item.insertText + text.slice(caret);
    props.onChange(next);
    setSuggestOpen(false);
    requestAnimationFrame(() => {
      const pos = start + item.insertText.length;
      textarea.setSelectionRange(pos, pos);
      textarea.focus();
    });
  };

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        id={props.id}
        name={props.name}
        disabled={props.disabled}
        value={props.value ?? ''}
        rows={4}
        className="border-input bg-background focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2"
        {...fieldAria(props)}
        onChange={(event) => {
          props.onChange(event.target.value);
          updateSuggest(event.target.value, event.target.selectionStart);
        }}
        onKeyDown={(event) => {
          if (!suggestOpen || items.length === 0) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlighted((prev) => (prev + 1) % items.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlighted((prev) => (prev - 1 + items.length) % items.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            accept(highlighted);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setSuggestOpen(false);
          }
        }}
        onBlur={() => {
          window.setTimeout(() => setSuggestOpen(false), 150);
        }}
      />
      {suggestOpen && items.length > 0 && suggestRect
        ? createPortal(
            <div
              className="bg-popover border-border z-50 rounded-md border shadow-md"
              style={{
                position: 'fixed',
                top: suggestRect.bottom + 4,
                left: suggestRect.left,
                minWidth: suggestRect.width,
              }}
            >
              {suggest.render({
                items,
                highlighted,
                query: suggestQuery,
                rect: suggestRect,
                accept,
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function ListField(props: FieldControlProps<'list'>) {
  const items = props.value ?? [];
  const { min = 0, max = Number.POSITIVE_INFINITY } = props.spec;
  const update = (next: Array<string | number | boolean>) =>
    props.onChange(next);
  const swap = (from: number, to: number) => {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (moved !== undefined) next.splice(to, 0, moved);
    update(next);
  };

  return (
    <div
      id={props.id}
      role="group"
      data-slot="editor-list"
      className="flex flex-col gap-2"
      {...fieldAria(props)}
    >
      <ol className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li
            key={index}
            className="border-border flex flex-col gap-2 rounded-md border p-2"
          >
            {props.renderElement?.({
              spec: {
                ...props.spec.of,
                label: `${props.spec.label} ${index + 1}`,
              },
              value: item,
              onChange: (next) => {
                const copy = [...items];
                copy[index] = next as string | number | boolean;
                update(copy);
              },
              id: `${props.id}-${index}`,
              name: `${props.name}[${index}]`,
              index,
              disabled: props.disabled,
              invalid: false,
              describedBy: undefined,
            })}
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                variant="outline"
                size="xs"
                aria-label={`Move ${props.spec.label} ${index + 1} up`}
                disabled={props.disabled || index === 0}
                onClick={() => swap(index, index - 1)}
              >
                Up
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                aria-label={`Move ${props.spec.label} ${index + 1} down`}
                disabled={props.disabled || index === items.length - 1}
                onClick={() => swap(index, index + 1)}
              >
                Down
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                aria-label={`Remove ${props.spec.label} ${index + 1}`}
                disabled={props.disabled || items.length <= min}
                onClick={() => update(items.filter((_, i) => i !== index))}
              >
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={`Add ${props.spec.label}`}
        disabled={props.disabled || items.length >= max}
        onClick={() => update([...items, emptyListElement(props.spec.of)])}
      >
        Add
      </Button>
    </div>
  );
}

export const cmsFields = {
  image: MediaField,
  reference: ReferencePicker,
  link: LinkField,
  richText: RichTextField,
  list: ListField,
} satisfies FieldControls;

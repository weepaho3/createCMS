'use client';

import type { FieldControlProps, FieldControls } from '@createcms/react/editor';
import type {
  CmsFieldSources,
  CmsRootListItem,
} from '@createcms/react/editor/cms';
import type { MediaClient } from '@createcms/react/media';

import {
  Editor,
  emptyListElement,
  fromDatetimeLocal,
  toDatetimeLocal,
} from '@createcms/react/editor';
import {
  assetUrl,
  referenceLabel,
  useVariableSuggest,
} from '@createcms/react/editor/cms';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Textarea } from '@/components/ui/textarea';

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

function fieldAria(props: {
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  readOnly?: boolean;
}) {
  return {
    'aria-describedby': props.describedBy,
    'aria-invalid': props.invalid || undefined,
    'aria-required': props.required || undefined,
    'aria-readonly': props.readOnly || undefined,
  } as const;
}

function TextField(props: FieldControlProps<'text'>) {
  return (
    <Input
      type="text"
      id={props.id}
      name={props.name}
      value={props.value ?? ''}
      placeholder={props.spec.placeholder}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      minLength={props.spec.minLength}
      maxLength={props.spec.maxLength}
      {...fieldAria(props)}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  );
}

function TextareaField(props: FieldControlProps<'textarea'>) {
  return (
    <Textarea
      id={props.id}
      name={props.name}
      value={props.value ?? ''}
      placeholder={props.spec.placeholder}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      minLength={props.spec.minLength}
      maxLength={props.spec.maxLength}
      rows={3}
      {...fieldAria(props)}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  );
}

function ColorField(props: FieldControlProps<'color'>) {
  return (
    <Input
      type="color"
      id={props.id}
      name={props.name}
      value={props.value ?? '#000000'}
      required={props.required}
      disabled={props.disabled || props.readOnly}
      className="h-9 w-16 p-1"
      {...fieldAria(props)}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  );
}

function NumberField(props: FieldControlProps<'number'>) {
  return (
    <Input
      type="number"
      id={props.id}
      name={props.name}
      value={props.value ?? ''}
      placeholder={props.spec.placeholder}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      min={props.spec.min}
      max={props.spec.max}
      step={props.spec.step}
      {...fieldAria(props)}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        props.onChange(raw === '' ? undefined : Number(raw));
      }}
    />
  );
}

function BooleanField(props: FieldControlProps<'boolean'>) {
  return (
    <Checkbox
      id={props.id}
      name={props.name}
      checked={props.value ?? false}
      required={props.required}
      disabled={props.disabled || props.readOnly}
      {...fieldAria(props)}
      onCheckedChange={(checked) => props.onChange(checked)}
    />
  );
}

function DateField(props: FieldControlProps<'date'>) {
  return (
    <Input
      type="datetime-local"
      id={props.id}
      name={props.name}
      value={toDatetimeLocal(props.value)}
      required={props.required}
      disabled={props.disabled}
      readOnly={props.readOnly}
      {...fieldAria(props)}
      onChange={(event) =>
        props.onChange(fromDatetimeLocal(event.currentTarget.value))
      }
    />
  );
}

function SelectField(props: FieldControlProps<'select'>) {
  if (props.spec.multiple) {
    const selected = Array.isArray(props.value) ? props.value : [];
    return (
      <div
        id={props.id}
        role="group"
        className="flex flex-col gap-2"
        {...fieldAria(props)}
      >
        {props.spec.options.map((option) => (
          <label key={option.value} className="flex items-center gap-2">
            <Checkbox
              checked={selected.includes(option.value)}
              disabled={props.disabled || props.readOnly}
              onCheckedChange={(checked) =>
                props.onChange(
                  checked
                    ? [...selected, option.value]
                    : selected.filter((value) => value !== option.value),
                )
              }
            />
            {option.label}
          </label>
        ))}
      </div>
    );
  }
  return (
    <Select
      id={props.id}
      name={props.name}
      value={typeof props.value === 'string' ? props.value : null}
      required={props.required}
      disabled={props.disabled || props.readOnly}
      items={props.spec.options.map((option) => ({
        value: option.value,
        label: option.label,
      }))}
      onValueChange={(value) =>
        props.onChange(value === null || value === '' ? undefined : value)
      }
    >
      <SelectTrigger className="w-full" {...fieldAria(props)}>
        <SelectValue placeholder={props.spec.placeholder ?? ''} />
      </SelectTrigger>
      <SelectContent>
        {props.spec.options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
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

const RICH_TEXT_BUTTON =
  'text-muted-foreground hover:bg-accent hover:text-accent-foreground aria-pressed:bg-accent aria-pressed:text-accent-foreground inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium disabled:pointer-events-none disabled:opacity-50';

const RICH_TEXT_MARKS = [
  { mark: 'bold', label: 'B', title: 'Bold', className: 'font-bold' },
  { mark: 'italic', label: 'I', title: 'Italic', className: 'italic' },
  { mark: 'underline', label: 'U', title: 'Underline', className: 'underline' },
  {
    mark: 'strike',
    label: 'S',
    title: 'Strikethrough',
    className: 'line-through',
  },
] as const;

/**
 * Rich text with a formatting toolbar and `{{variable}}` completion. The
 * editor comes from `Editor.Root richText` (loaded on first focus); without
 * it the field shows its formatted text read-only.
 */
function RichTextField(props: FieldControlProps<'richText'>) {
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
  const marks = props.spec.marks;
  return (
    <Editor.RichTextField
      suggest={{ items }}
      className="border-input focus-within:ring-ring/50 focus-within:border-ring dark:bg-input/30 rounded-md border bg-transparent shadow-xs focus-within:ring-[3px] data-[invalid]:border-destructive [&_[contenteditable]]:min-h-24 [&_[contenteditable]]:px-3 [&_[contenteditable]]:py-2 [&_[contenteditable]]:outline-none [&_[data-editor-richtext-hint]]:text-muted-foreground [&_[data-editor-richtext-hint]]:px-3 [&_[data-editor-richtext-hint]]:pb-2 [&_[data-editor-richtext-hint]]:text-xs [&_[data-editor-richtext-suggestions]]:bg-popover [&_[data-editor-richtext-suggestions]]:z-50 [&_[data-editor-richtext-suggestions]]:min-w-48 [&_[data-editor-richtext-suggestions]]:rounded-md [&_[data-editor-richtext-suggestions]]:border [&_[data-editor-richtext-suggestions]]:p-1 [&_[data-editor-richtext-suggestions]]:shadow-md [&_[role=option]]:flex [&_[role=option]]:cursor-default [&_[role=option]]:justify-between [&_[role=option]]:gap-4 [&_[role=option]]:rounded-sm [&_[role=option]]:px-2 [&_[role=option]]:py-1.5 [&_[role=option]]:text-sm [&_[role=option][data-highlighted]]:bg-accent"
    >
      <Editor.RichTextToolbar className="border-input flex flex-wrap gap-1 border-b p-1">
        {RICH_TEXT_MARKS.filter(
          (item) => marks === undefined || marks.includes(item.mark),
        ).map((item) => (
          <Editor.RichTextToolbarButton
            key={item.mark}
            mark={item.mark}
            aria-label={item.title}
            title={item.title}
            className={`${RICH_TEXT_BUTTON} ${item.className}`}
          >
            {item.label}
          </Editor.RichTextToolbarButton>
        ))}
        {props.spec.inline ? null : (
          <>
            <Editor.RichTextToolbarButton
              node="heading"
              attrs={{ level: 2 }}
              aria-label="Heading"
              title="Heading"
              className={RICH_TEXT_BUTTON}
            >
              H2
            </Editor.RichTextToolbarButton>
            <Editor.RichTextToolbarButton
              node="bulletList"
              aria-label="Bulleted list"
              title="Bulleted list"
              className={RICH_TEXT_BUTTON}
            >
              •
            </Editor.RichTextToolbarButton>
            <Editor.RichTextToolbarButton
              node="orderedList"
              aria-label="Numbered list"
              title="Numbered list"
              className={RICH_TEXT_BUTTON}
            >
              1.
            </Editor.RichTextToolbarButton>
          </>
        )}
      </Editor.RichTextToolbar>
    </Editor.RichTextField>
  );
}

function ListField(props: FieldControlProps<'list'>) {
  const items = props.value ?? [];
  const { min = 0, max = Number.POSITIVE_INFINITY } = props.spec;
  const label = props.spec.label ?? props.name;
  const locked = props.disabled || props.readOnly;
  const update = (next: unknown[]) => props.onChange(next);
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
              spec: { ...props.spec.of, label: `${label} ${index + 1}` },
              value: item,
              onChange: (next) => {
                const copy = [...items];
                copy[index] = next;
                update(copy);
              },
              id: `${props.id}-${index}`,
              name: `${props.name}[${index}]`,
              index,
              disabled: props.disabled,
              readOnly: props.readOnly,
              invalid: false,
              describedBy: undefined,
            })}
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                variant="outline"
                size="xs"
                aria-label={`Move ${label} ${index + 1} up`}
                disabled={locked || index === 0}
                onClick={() => swap(index, index - 1)}
              >
                Up
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                aria-label={`Move ${label} ${index + 1} down`}
                disabled={locked || index === items.length - 1}
                onClick={() => swap(index, index + 1)}
              >
                Down
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                aria-label={`Remove ${label} ${index + 1}`}
                disabled={locked || items.length <= min}
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
        aria-label={`Add ${label}`}
        disabled={locked || items.length >= max}
        onClick={() => update([...items, emptyListElement(props.spec.of)])}
      >
        Add
      </Button>
    </div>
  );
}

function ObjectField(props: FieldControlProps<'object'>) {
  const value = props.value ?? {};
  return (
    <div
      id={props.id}
      role="group"
      data-slot="editor-object"
      className="border-border flex flex-col gap-3 rounded-md border p-3"
      {...fieldAria(props)}
    >
      {Object.entries(props.spec.fields).map(([key, spec]) => (
        <div key={key} className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{spec.label ?? key}</span>
          {props.renderNested?.({
            spec: { ...spec, label: spec.label ?? key },
            fieldKey: key,
            value: value[key],
            onChange: (next) => {
              const copy: Record<string, unknown> = { ...value };
              if (next === undefined) delete copy[key];
              else copy[key] = next;
              props.onChange(copy);
            },
            id: `${props.id}-${key}`,
            name: `${props.name}.${key}`,
            disabled: props.disabled,
            readOnly: props.readOnly,
            invalid: false,
            describedBy: undefined,
          })}
        </div>
      ))}
    </div>
  );
}

export const cmsFields = {
  text: TextField,
  textarea: TextareaField,
  number: NumberField,
  boolean: BooleanField,
  date: DateField,
  color: ColorField,
  select: SelectField,
  media: MediaField,
  reference: ReferencePicker,
  link: LinkField,
  richText: RichTextField,
  list: ListField,
  object: ObjectField,
} satisfies FieldControls;

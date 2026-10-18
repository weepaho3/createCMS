'use client';

// Self-contained picker control: a dialog that owns its own Media.Root (the
// one registry:ui exception to the no-Root convention, like a combobox owns
// its listbox) and returns one selected asset id. Picker constraints lock
// unsuitable assets with a reason. MediaImageField adds the alt text,
// decorative switch and caption of the chosen image. check-registry.mjs
// keeps rejecting Editor.Root and Canvas.Root in ui output, requires
// Media.Root here and rejects it in media-library.

import type {
  MediaClient,
  MediaMessagesInput,
  MediaUploadEntry,
} from '@createcms/react/media';
import type {
  AltSuggestAdapter,
  ImageRef,
  PickerConstraints,
} from '@createcms/react/media/core';

import {
  ImageField,
  Media,
  Picker,
  mergeMediaMessages,
  useMediaMessages,
  useMediaSelection,
} from '@createcms/react/media';
import {
  createMemoryFilterAdapter,
  pickerDisabledReason,
  pickerFilter,
  replaceImageAsset,
} from '@createcms/react/media/core';
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
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import {
  MediaAssetCard,
  MediaBreadcrumbs,
  MediaDropzone,
  MediaEmpty,
  MediaError,
  MediaFolderCard,
  MediaFolderList,
  MediaGrid,
  MediaLoadMore,
  MediaSearch,
  MediaUploadList,
} from './media-library';

export type MediaPickerProps = {
  client: MediaClient;
  value?: string;
  onChange: (id: string) => void;
  /** Like the `accept` attribute; filters the grid on the server and the dropzone (default `image/*`). */
  accept?: string;
  /** Size, dimension and aspect rules; unsuitable assets are locked with a reason. */
  constraints?: Omit<PickerConstraints, 'mode' | 'accept'>;
  /** The dialog trigger; a `<Button>` labelled `picker.choose` when omitted. */
  trigger?: React.ReactElement;
  /** Dialog title; `picker.title` when omitted. */
  title?: string;
  /** Partial catalog for the picker and its `Media.Root`. */
  messages?: MediaMessagesInput;
  /** BCP 47 locale, passed to `Media.Root`. */
  locale?: string;
  disabled?: boolean;
  className?: string;
};

function pickable(
  asset: Parameters<typeof pickerDisabledReason>[0],
  constraints: PickerConstraints,
): boolean {
  return pickerDisabledReason(asset, constraints) === null;
}

function PickerSelection({ value }: { value: string | undefined }) {
  const { select } = useMediaSelection();
  const valueRef = React.useRef(value);

  React.useEffect(() => {
    if (valueRef.current) select(valueRef.current);
  }, [select]);

  return null;
}

function PickerFooter({
  onSelect,
  onCancel,
}: {
  onSelect: (id: string) => void;
  onCancel: () => void;
}) {
  const { messages: t } = useMediaMessages();
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        {t.action.cancel}
      </Button>
      <Picker.Confirm
        render={<Button type="button" />}
        onConfirm={(assets) => onSelect(assets[0].id)}
      >
        {t.picker.select}
      </Picker.Confirm>
    </DialogFooter>
  );
}

function MediaPicker({
  client,
  value,
  onChange,
  accept = 'image/*',
  constraints: rules,
  trigger,
  title,
  messages,
  locale,
  disabled,
  className,
}: MediaPickerProps) {
  const [open, setOpen] = React.useState(false);
  // The trigger and title render outside Media.Root, so merge here too.
  const t = React.useMemo(() => mergeMediaMessages(messages), [messages]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const onUploaded = (entries: MediaUploadEntry[]) => {
    const only = entries.length === 1 ? entries[0].result : undefined;
    if (only) choose(only.id);
  };
  const constraints = React.useMemo<PickerConstraints>(
    () => ({
      ...rules,
      mode: 'single',
      accept: accept
        .split(',')
        .map((rule) => rule.trim())
        .filter(Boolean),
    }),
    [rules, accept],
  );
  // The picker keeps its filter in memory: it never touches the page URL.
  const filterUrl = React.useMemo(
    () => createMemoryFilterAdapter(pickerFilter(constraints)),
    [constraints],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        disabled={disabled}
        render={
          trigger ?? (
            <Button type="button" variant="outline">
              {t.picker.choose}
            </Button>
          )
        }
      />
      <DialogContent
        data-slot="media-picker"
        className={cn('flex max-h-[85vh] max-w-3xl flex-col', className)}
      >
        <DialogHeader>
          <DialogTitle>{title ?? t.picker.title}</DialogTitle>
        </DialogHeader>
        <Media.Root
          client={client}
          selection="single"
          filterUrl={filterUrl}
          expandedStorageKey={false}
          messages={messages}
          locale={locale}
        >
          <PickerSelection value={value} />
          <Picker.Root constraints={constraints}>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              <div className="flex flex-wrap items-center gap-2">
                <MediaBreadcrumbs className="mr-auto" />
                <MediaSearch />
              </div>
              <MediaError />
              <MediaDropzone accept={accept} onUploaded={onUploaded} />
              <MediaFolderList>
                {(folder) => (
                  <MediaFolderCard key={folder.id} folder={folder} />
                )}
              </MediaFolderList>
              <MediaGrid
                onAction={(asset) => {
                  if (pickable(asset, constraints)) choose(asset.id);
                }}
              >
                {(asset) => <MediaAssetCard key={asset.id} asset={asset} />}
              </MediaGrid>
              <MediaEmpty />
              <MediaLoadMore />
              <MediaUploadList />
            </div>
            <PickerFooter onSelect={choose} onCancel={() => setOpen(false)} />
          </Picker.Root>
        </Media.Root>
      </DialogContent>
    </Dialog>
  );
}

export type MediaImageFieldProps = Omit<
  MediaPickerProps,
  'value' | 'onChange'
> & {
  /** The stored image use, or `null` before one is chosen. */
  value: ImageRef | null;
  onChange: (value: ImageRef | null) => void;
  /** Saving needs alt text or "decorative". */
  requireAlt?: boolean;
  /** Alt text suggesters, asked in order. */
  suggesters?: readonly AltSuggestAdapter[];
};

/**
 * An image field: the picker plus the alt text, decorative switch and
 * caption of this use. Choosing another image keeps the texts.
 */
function MediaImageField({
  value,
  onChange,
  requireAlt,
  suggesters,
  ...picker
}: MediaImageFieldProps) {
  const t = React.useMemo(
    () => mergeMediaMessages(picker.messages),
    [picker.messages],
  );
  const id = React.useId();
  return (
    <div data-slot="media-image-field" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <MediaPicker
          {...picker}
          value={value?.assetId}
          onChange={(assetId) =>
            onChange(value ? replaceImageAsset(value, assetId) : { assetId })
          }
          trigger={
            <Button type="button" variant="outline">
              {value ? t.imageField.replace : t.imageField.choose}
            </Button>
          }
        />
        {value ? (
          <Button type="button" variant="ghost" onClick={() => onChange(null)}>
            {t.imageField.remove}
          </Button>
        ) : null}
      </div>
      {value ? (
        <ImageField.Root
          value={value}
          onValueChange={onChange}
          requireAlt={requireAlt}
          suggesters={suggesters}
        >
          <label htmlFor={`${id}-alt`} className="text-sm font-medium">
            {t.imageField.alt}
          </label>
          <p className="text-muted-foreground text-xs">
            {t.imageField.altHint}
          </p>
          <ImageField.Alt
            id={`${id}-alt`}
            render={
              <Textarea rows={2} className="aria-invalid:border-destructive" />
            }
          />
          <div className="flex flex-wrap items-center gap-2">
            <ImageField.Status className="text-muted-foreground mr-auto text-xs data-[alt-state=missing]:text-destructive" />
            <ImageField.SuggestAlt
              render={<Button type="button" variant="ghost" size="sm" />}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <ImageField.Decorative className="size-4 accent-[var(--color-primary)]" />
            {t.imageField.decorative}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t.imageField.caption}</span>
            <ImageField.Caption render={<Input />} />
          </label>
        </ImageField.Root>
      ) : null}
    </div>
  );
}

export { MediaImageField, MediaPicker };

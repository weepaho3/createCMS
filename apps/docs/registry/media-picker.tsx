'use client';

// Self-contained picker control: a dialog that owns its own Media.Root (the
// one registry:ui exception to the no-Root convention, like a combobox owns
// its listbox) and returns one selected asset id. check-registry.mjs keeps
// rejecting Editor.Root and Canvas.Root in ui output, requires Media.Root
// here and rejects it in media-library.

import type {
  MediaClient,
  MediaMessagesInput,
  MediaUploadEntry,
} from '@createcms/react/media';

import {
  Media,
  mergeMediaMessages,
  useMediaMessages,
  useMediaSelection,
} from '@createcms/react/media';
import {
  createMemoryFilterAdapter,
  type FilterState,
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

/** MIME types and prefixes of an `accept` attribute (extensions are left out). */
function mimeOfAccept(accept: string): string[] {
  return accept
    .split(',')
    .map((rule) => rule.trim().toLowerCase())
    .filter((rule) => rule.includes('/'));
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
  const { selected } = useMediaSelection();
  const id = selected.length === 1 ? selected[0] : undefined;

  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        {t.action.cancel}
      </Button>
      <Button
        type="button"
        disabled={id === undefined}
        onClick={() => {
          if (id !== undefined) onSelect(id);
        }}
      >
        {t.picker.select}
      </Button>
    </DialogFooter>
  );
}

function MediaPicker({
  client,
  value,
  onChange,
  accept = 'image/*',
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
  // The picker keeps its filter in memory: it never touches the page URL.
  const filterUrl = React.useMemo(() => {
    const filter: FilterState = { sort: 'created_desc' };
    const mime = mimeOfAccept(accept);
    if (mime.length > 0) filter.mime = mime;
    return createMemoryFilterAdapter(filter);
  }, [accept]);

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
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
            <div className="flex flex-wrap items-center gap-2">
              <MediaBreadcrumbs className="mr-auto" />
              <MediaSearch />
            </div>
            <MediaError />
            <MediaDropzone accept={accept} onUploaded={onUploaded} />
            <MediaFolderList>
              {(folder) => <MediaFolderCard key={folder.id} folder={folder} />}
            </MediaFolderList>
            <MediaGrid onAction={(asset) => choose(asset.id)}>
              {(asset) => <MediaAssetCard key={asset.id} asset={asset} />}
            </MediaGrid>
            <MediaEmpty />
            <MediaLoadMore />
            <MediaUploadList />
          </div>
          <PickerFooter onSelect={choose} onCancel={() => setOpen(false)} />
        </Media.Root>
      </DialogContent>
    </Dialog>
  );
}

export { MediaPicker };

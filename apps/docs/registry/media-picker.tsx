'use client';

// Self-contained picker control: a dialog that owns its own Media.Root (the
// one registry:ui exception to the no-Root convention, like a combobox owns
// its listbox) and returns one selected asset id. check-registry.mjs keeps
// rejecting Editor.Root and Canvas.Root in ui output, requires Media.Root
// here and rejects it in media-library.

import type {
  MediaClient,
  MediaMessagesInput,
  MediaUploadedAsset,
} from '@createcms/react/media';

import {
  Media,
  mergeMediaMessages,
  useMediaLibrary,
  useMediaMessages,
  useMediaSelection,
} from '@createcms/react/media';
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
  MEDIA_EMPTY_CLASS,
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
  matchesAccept,
} from './media-library';

/** Pages fetched automatically per folder or query while every listed asset is filtered out. */
const AUTO_PAGE_LIMIT = 5;

export type MediaPickerProps = {
  client: MediaClient;
  value?: string;
  onChange: (id: string) => void;
  /** Like the `accept` attribute; filters the grid and the dropzone (default `image/*`). */
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

function PickerSelection({ value }: { value: string | undefined }) {
  const { select } = useMediaSelection();
  const valueRef = React.useRef(value);

  React.useEffect(() => {
    if (valueRef.current) select(valueRef.current);
  }, [select]);

  return null;
}

/**
 * The grid with its own roving `tabIndex` over the assets that match
 * `accept`. `Media.Grid` hands `tabIndex=0` to the first listed asset, which
 * `MediaAssetCard` does not render when it fails `accept`; the override keeps
 * exactly one rendered option tabbable.
 */
function PickerGrid({ accept }: { accept: string | undefined }) {
  const { assets } = useMediaLibrary();
  const { selected } = useMediaSelection();
  const [focusedId, setFocusedId] = React.useState<string | null>(null);

  const visible = assets.filter((asset) => matchesAccept(accept, asset));
  const isVisible = (id: string | null): id is string =>
    id !== null && visible.some((asset) => asset.id === id);
  const activeId = isVisible(focusedId)
    ? focusedId
    : isVisible(selected[0] ?? null)
      ? selected[0]
      : (visible[0]?.id ?? null);

  return (
    <MediaGrid>
      {(asset) => (
        <MediaAssetCard
          key={asset.id}
          asset={asset}
          accept={accept}
          tabIndex={activeId === asset.id ? 0 : -1}
          onFocus={() => setFocusedId(asset.id)}
        />
      )}
    </MediaGrid>
  );
}

/**
 * Appends pages while every listed asset is hidden by `accept` and a cursor
 * remains, at most `AUTO_PAGE_LIMIT` times per folder, search or sort.
 * Renders the empty notice once no cursor is left and no page showed an asset;
 * with a cursor left past the limit only `MediaLoadMore` stays.
 */
function PickerAutoPage({ accept }: { accept: string | undefined }) {
  const { messages: t } = useMediaMessages();
  const {
    assets,
    folders,
    folderId,
    search,
    sortBy,
    sortDirection,
    nextCursor,
    status,
    loadMore,
  } = useMediaLibrary();
  const attempts = React.useRef(0);
  const queryKey = `${folderId ?? ''}\u0000${search}\u0000${sortBy}\u0000${sortDirection}`;
  const lastQuery = React.useRef(queryKey);
  if (lastQuery.current !== queryKey) {
    lastQuery.current = queryKey;
    attempts.current = 0;
  }

  const visible = assets.filter((asset) => matchesAccept(accept, asset));
  const allHidden = assets.length > 0 && visible.length === 0;
  const canAutoPage =
    allHidden &&
    nextCursor !== null &&
    status === 'idle' &&
    attempts.current < AUTO_PAGE_LIMIT;

  React.useEffect(() => {
    if (!canAutoPage) return;
    attempts.current += 1;
    void loadMore();
  }, [canAutoPage, loadMore]);

  if (
    !allHidden ||
    nextCursor !== null ||
    status !== 'idle' ||
    folders.length > 0
  ) {
    return null;
  }
  return (
    <div data-slot="media-empty" className={MEDIA_EMPTY_CLASS}>
      {t.list.empty}
    </div>
  );
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

  const onUploaded = (assets: MediaUploadedAsset[]) => {
    const only = assets.length === 1 ? assets[0] : undefined;
    if (only) choose(only.id);
  };

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
            <PickerGrid accept={accept} />
            <MediaEmpty />
            <PickerAutoPage accept={accept} />
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

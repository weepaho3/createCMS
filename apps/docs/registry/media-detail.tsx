'use client';

// The detail panel of the selected asset: name, description, rights,
// origin, facts, focal point and earlier versions. Renders inside a
// Media.Root, next to MediaLibraryLayout or any grid.

import type { FocalPoint as FocalPointValue } from '@createcms/react/media/core';

import {
  Detail,
  Download,
  FocalPoint,
  useAssetDetail,
  useMediaContext,
  useMediaMessages,
  useMediaSelection,
} from '@createcms/react/media';
import { previewKindOf } from '@createcms/react/media/core';
import { FileIcon, Maximize2Icon, XIcon } from 'lucide-react';
import * as React from 'react';

import { Alert, AlertAction, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const RIGHTS = [
  'credit',
  'copyright',
  'license',
  'licenseUrl',
  'sourceUrl',
] as const;

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      {children}
    </label>
  );
}

/** Opens the detail of the one selected asset and closes it otherwise. */
function useFollowSelection() {
  const { selected } = useMediaSelection();
  const { open, close } = useAssetDetail();
  const only = selected.length === 1 ? selected[0] : null;
  const commands = React.useRef({ open, close });
  commands.current = { open, close };
  React.useEffect(() => {
    if (only) commands.current.open(only);
    else commands.current.close();
  }, [only]);
}

/**
 * The selected asset itself: the image, a playable video or audio file, or
 * its type icon. The button opens the fullscreen preview (also Space in
 * the grid).
 */
function MediaDetailPreview() {
  const { messages: t, format } = useMediaMessages();
  const { asset } = useAssetDetail();
  const { store, assetUrl } = useMediaContext('MediaDetailPreview');
  if (!asset) return null;
  const kind = previewKindOf(asset.mimeType);
  const src = assetUrl(asset);
  const name = asset.originalName ?? asset.slug;
  return (
    <div className="bg-muted relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-md">
      {/* An <img> never runs an SVG's scripts. */}
      {kind === 'image' || kind === 'svg' ? (
        <img
          src={src}
          alt=""
          draggable={false}
          className="size-full object-contain"
        />
      ) : kind === 'video' ? (
        <video
          key={asset.id}
          src={src}
          controls
          preload="metadata"
          className="size-full object-contain"
        />
      ) : kind === 'audio' ? (
        <audio key={asset.id} src={src} controls className="w-11/12" />
      ) : (
        <FileIcon
          className="text-muted-foreground size-10"
          aria-hidden="true"
        />
      )}
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        className="absolute top-2 right-2 shadow-sm"
        aria-label={t.preview.label({ name }, format)}
        title={t.preview.label({ name }, format)}
        onClick={() =>
          void store.dispatch({ type: 'openPreview', id: asset.id })
        }
      >
        <Maximize2Icon className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

function MediaFocalPointEditor() {
  const { messages: t } = useMediaMessages();
  const { asset } = useAssetDetail();
  const { store, assetUrl } = useMediaContext('MediaFocalPointEditor');
  if (!asset?.width || !asset.height) return null;
  if (previewKindOf(asset.mimeType) !== 'image') return null;
  const focal = (asset.metadata as { focal?: FocalPointValue } | undefined)
    ?.focal;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-muted-foreground text-xs">{t.focal.label}</span>
      <FocalPoint.Root
        key={asset.id}
        image={{
          src: assetUrl(asset),
          width: asset.width,
          height: asset.height,
        }}
        defaultValue={focal ?? null}
        onValueCommit={(point) =>
          void store.dispatch({
            type: 'setFocalPoint',
            id: asset.id,
            focal: point,
          })
        }
        className="bg-muted overflow-hidden rounded-md"
      >
        <img
          src={assetUrl(asset)}
          alt=""
          draggable={false}
          className="block w-full"
        />
        <FocalPoint.Handle className="focus-visible:ring-ring size-5 rounded-full border-2 border-white bg-black/40 shadow outline-none focus-visible:ring-2" />
      </FocalPoint.Root>
      <div className="grid grid-cols-3 gap-2">
        {['aspect-square', 'aspect-video', 'aspect-[4/5]'].map((aspect) => (
          <FocalPoint.Root
            key={aspect}
            image={{
              src: assetUrl(asset),
              width: asset.width!,
              height: asset.height!,
            }}
            value={focal ?? null}
          >
            <FocalPoint.Preview className={cn('w-full rounded-sm', aspect)} />
          </FocalPoint.Root>
        ))}
      </div>
    </div>
  );
}

function MediaRevisions() {
  const { messages: t, format } = useMediaMessages();
  return (
    <Detail.Revisions>
      {({ revisions, restore }) => (
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs">
            {t.detail.revisions}
          </span>
          {revisions && revisions.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t.detail.noRevisions}
            </p>
          ) : null}
          <ul className="flex flex-col gap-1">
            {(revisions ?? []).map((revision) => (
              <li key={revision.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {revision.originalName}
                </span>
                <span className="text-muted-foreground text-xs">
                  {format.date(revision.createdAt)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => restore(revision.id)}
                >
                  {t.detail.restoreRevision}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Detail.Revisions>
  );
}

/**
 * The detail form of the one selected asset; renders nothing while zero
 * or several assets are selected.
 */
function MediaDetailPanel({
  className,
  onClose,
}: {
  className?: string;
  /** Shows a close button; `MediaLibraryLayout` clears the selection with it. */
  onClose?: () => void;
}) {
  useFollowSelection();
  const { messages: t, format } = useMediaMessages();
  const { asset } = useAssetDetail();
  return (
    <Detail.Root
      data-slot="media-detail"
      className={cn(
        'bg-card flex flex-col gap-4 rounded-lg border p-4',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="mr-auto text-sm font-medium">{t.detail.title}</h3>
        {asset ? (
          <Download.Button
            assets={[asset]}
            render={<Button type="button" variant="outline" size="sm" />}
          />
        ) : null}
        {onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t.preview.close}
            onClick={onClose}
          >
            <XIcon className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <MediaDetailPreview />
      <Detail.Conflict>
        {({ theirs, keepMine, takeTheirs }) => (
          <Alert variant="destructive">
            <AlertTitle>
              {t.detail.conflict(
                { name: theirs.originalName ?? theirs.slug },
                format,
              )}
            </AlertTitle>
            <AlertAction className="flex gap-2">
              <Button type="button" size="sm" onClick={keepMine}>
                {t.detail.keepMine}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={takeTheirs}
              >
                {t.detail.takeTheirs}
              </Button>
            </AlertAction>
          </Alert>
        )}
      </Detail.Conflict>
      <Detail.Error className="text-destructive text-sm" />
      <Field label={t.detail.name}>
        <Detail.Field field="originalName" render={<Input />} />
      </Field>
      <Field label={t.detail.description}>
        <Detail.Field field="description" render={<Textarea rows={3} />} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        {RIGHTS.map((key) => (
          <Field key={key} label={t.detail.rights[key]}>
            <Detail.Field field={`rights.${key}`} render={<Input />} />
          </Field>
        ))}
      </div>
      <Field label={t.detail.provenance}>
        <Detail.Provenance className="border-input bg-background h-8 rounded-md border px-2 text-sm" />
      </Field>
      <div className="flex gap-2">
        <Detail.Save render={<Button type="submit" size="sm" />} />
        <Detail.Reset
          render={<Button type="button" variant="ghost" size="sm" />}
        />
      </div>
      <MediaFocalPointEditor />
      <Detail.Facts className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm [&_dt]:text-muted-foreground" />
      <MediaRevisions />
    </Detail.Root>
  );
}

export {
  MediaDetailPanel,
  MediaDetailPreview,
  MediaFocalPointEditor,
  MediaRevisions,
};

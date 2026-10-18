'use client';

import { Media } from '@createcms/react/media';
import { createHistoryFilterAdapter } from '@createcms/react/media/core';
import * as React from 'react';

import { demoMedia } from '@/app/demo/_lib/demo-media-client';
import {
  MediaDetailPanel,
  MediaLibraryLayout,
} from '@/components/media-library';

export default function DemoMediaPage() {
  // The filter lives in the URL: copy it to share the view.
  const [filterUrl] = React.useState(() => createHistoryFilterAdapter());
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 overflow-y-auto p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Media library</h1>
        <p className="text-muted-foreground text-sm">
          MediaLibraryLayout and MediaDetailPanel inside Media.Root against an
          in-memory client. Folders, moves, status changes, details and focal
          points persist until reload; uploads stay idle. Double click an asset
          to preview it, select one to edit it. Filters are kept in the URL.
        </p>
      </div>
      <Media.Root client={demoMedia} selection="multiple" filterUrl={filterUrl}>
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <MediaLibraryLayout />
          <MediaDetailPanel className="self-start" />
        </div>
      </Media.Root>
    </main>
  );
}

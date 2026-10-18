'use client';

import { Media } from '@createcms/react/media';
import { createHistoryFilterAdapter } from '@createcms/react/media/core';
import * as React from 'react';

import { demoMedia } from '@/app/demo/_lib/demo-media-client';
import { MediaLibraryLayout } from '@/components/media-library';

export default function DemoMediaPage() {
  // The filter lives in the URL: copy it to share the view.
  const [filterUrl] = React.useState(() => createHistoryFilterAdapter());
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 overflow-y-auto p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Media library</h1>
        <p className="text-muted-foreground text-sm">
          MediaLibraryLayout inside Media.Root against an in-memory client.
          Folders, moves, status changes and archiving persist until reload;
          uploads stay idle. Filters are kept in the URL.
        </p>
      </div>
      <Media.Root client={demoMedia} selection="multiple" filterUrl={filterUrl}>
        <MediaLibraryLayout />
      </Media.Root>
    </main>
  );
}

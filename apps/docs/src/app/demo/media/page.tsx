'use client';

import { Media } from '@createcms/react/media';
import * as React from 'react';

import { demoMediaClient } from '@/app/demo/_lib/demo-media-client';
import { MediaLibraryLayout } from '@/components/media-library';

export default function DemoMediaPage() {
  const client = React.useMemo(() => demoMediaClient(), []);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 overflow-y-auto p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Media library</h1>
        <p className="text-muted-foreground text-sm">
          MediaLibraryLayout inside Media.Root against an in-memory client.
          Folders, moves, status changes and archiving persist until reload;
          uploads stay idle.
        </p>
      </div>
      <Media.Root client={client} selection="multiple">
        <MediaLibraryLayout />
      </Media.Root>
    </main>
  );
}

'use client';

import { createMemoryAdapter } from '@createcms/react/editor/core';

import { components, home, schema } from '@/app/demo/editor/app/memory-app';
import { EditorApp } from '@/components/ui-sdk-editor-app';

// One adapter per page load; saves are kept until the page reloads.
const adapter = createMemoryAdapter({ home }, { latencyMs: 300 });

/** The memory demo on the UI SDK editor, next to the shadcn one at /demo/editor/app. */
export function UiSdkMemoryEditorApp() {
  return (
    <EditorApp
      adapter={adapter}
      documentId="home"
      baseVersion={adapter.version('home')}
      schema={schema}
      components={components}
    />
  );
}

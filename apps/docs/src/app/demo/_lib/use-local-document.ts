'use client';

import type {
  EditorDocument,
  PersistenceOptions,
} from '@createcms/react/editor/core';

import * as React from 'react';

export function useLocalDocument(initial: EditorDocument) {
  const [saved, setSaved] = React.useState(initial);
  const latest = React.useRef(initial);
  const onChange = React.useCallback(
    (change: { getDocument: () => EditorDocument }) => {
      latest.current = change.getDocument();
    },
    [],
  );
  // An in-memory backend: the saved document is component state, the
  // version a counter. Saves only on the shell's Save button.
  const persistence = React.useMemo<PersistenceOptions>(() => {
    let version = 0;
    return {
      async save(doc) {
        setSaved(doc);
        version += 1;
        return { version: String(version) };
      },
      autosave: false,
    };
  }, []);
  return { saved, latest, onChange, persistence };
}

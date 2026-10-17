'use client';

import type { EditorDocument } from '@createcms/react/editor/core';

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
  const onSave = React.useCallback(async () => {
    setSaved(latest.current);
  }, []);
  return { saved, latest, onChange, onSave };
}

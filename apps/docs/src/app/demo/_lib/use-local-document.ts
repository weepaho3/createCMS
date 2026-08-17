'use client';

import type { BlockTreeNode } from '@createcms/core';

import * as React from 'react';

export function useLocalDocument(initial: BlockTreeNode) {
  const [saved, setSaved] = React.useState(initial);
  const latest = React.useRef(initial);
  const onChange = React.useCallback(
    (change: { getTree: () => BlockTreeNode }) => {
      latest.current = change.getTree();
    },
    [],
  );
  const onSave = React.useCallback(async () => {
    setSaved(latest.current);
  }, []);
  return { saved, latest, onChange, onSave };
}

import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type {
  AssetFacts,
  AssetProvenanceValue,
  DetailDraft,
  DetailField,
  DetailValues,
} from './core/detail';
import type { CommandResult, MediaStoreState } from './core/store';
import type { MediaAsset, MediaRevision } from './core/types';

import { mergeProps, useRender } from '../use-render';
import { useMediaContext, useMediaMessages } from './context';
import { assetFacts, detailValues, draftValue } from './core/detail';
import { errorCodeOf } from './core/errors';
import { assetName } from './grid';
import { mediaErrorMessage } from './messages';
import { useSelector } from './use-store';

export type AssetDetail = {
  /** The open asset as last loaded or saved, or `null`. */
  asset: MediaAsset | null;
  /** The asset's values with the draft applied. */
  values: DetailValues | null;
  draft: DetailDraft;
  facts: AssetFacts | null;
  dirty: boolean;
  saving: boolean;
  error: unknown;
  /** The newer server version after a conflicting save. */
  conflict: MediaAsset | null;
  revisions: MediaRevision[] | null;
  open: (id: string) => void;
  close: () => void;
  value: (field: DetailField) => unknown;
  set: (field: DetailField, value: unknown) => void;
  reset: () => void;
  save: () => Promise<CommandResult>;
  resolveConflict: (keep: 'mine' | 'theirs') => Promise<CommandResult>;
  loadRevisions: () => void;
  restoreRevision: (revisionId: string) => Promise<CommandResult>;
};

const selectDetail = (state: MediaStoreState) => state.detail;

/** A field value as input text; objects and missing values are empty. */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

const PROVENANCES: readonly AssetProvenanceValue[] = [
  'unknown',
  'captured',
  'ai_generated',
  'ai_edited',
];

/** The detail form of the enclosing `Media.Root`: draft, save, conflict, revisions. */
export function useAssetDetail(): AssetDetail {
  const { store } = useMediaContext('useAssetDetail');
  const detail = useSelector(store, selectDetail, Object.is);
  return React.useMemo(() => {
    const base = detail.asset ? detailValues(detail.asset) : null;
    const value = (field: DetailField) =>
      base ? draftValue(base, detail.draft, field) : undefined;
    const values: DetailValues | null = base
      ? {
          originalName: text(value('originalName')),
          description: text(value('description')),
          provenance: value('provenance') as AssetProvenanceValue,
          rights: { ...base.rights, ...detail.draft.rights },
          custom: { ...base.custom, ...detail.draft.custom },
        }
      : null;
    const id = detail.assetId;
    return {
      asset: detail.asset,
      values,
      draft: detail.draft,
      facts: detail.asset ? assetFacts(detail.asset) : null,
      dirty: detail.dirty,
      saving: detail.saving,
      error: detail.error,
      conflict: detail.conflict,
      revisions: detail.revisions,
      open: (assetId) =>
        void store.dispatch({ type: 'openDetail', id: assetId }),
      close: () => void store.dispatch({ type: 'closeDetail' }),
      value,
      set: (field, next) =>
        void store.dispatch({ type: 'setDetailField', field, value: next }),
      reset: () => void store.dispatch({ type: 'resetDetail' }),
      save: () => store.dispatch({ type: 'saveDetail' }),
      resolveConflict: (keep) =>
        store.dispatch({ type: 'resolveDetailConflict', keep }),
      loadRevisions: () => {
        if (id) void store.dispatch({ type: 'loadRevisions', id });
      },
      restoreRevision: async (revisionId) =>
        id
          ? store.dispatch({ type: 'setCurrentRevision', id, revisionId })
          : { ok: false, code: 'ASSET_NOT_FOUND', error: null },
    };
  }, [detail, store]);
}

const DetailContext = React.createContext<AssetDetail | null>(null);

function useDetailContext(name: string): AssetDetail {
  const value = React.useContext(DetailContext);
  if (!value) throw new Error(`${name} must be used within Detail.Root.`);
  return value;
}

// --- Detail.Root -------------------------------------------------------------------

type DetailRootState = { dirty: boolean; saving: boolean; conflict: boolean };

export type DetailRootProps = UseRenderComponentProps<'form', DetailRootState>;

/**
 * The detail form of the open asset (`useAssetDetail().open(id)`), rendered
 * only while one is open. Submitting saves; a save that conflicts with a
 * newer server version keeps the draft and shows `Detail.Conflict`.
 */
export function DetailRoot(props: DetailRootProps) {
  const { render, children, ...rest } = props;
  const detail = useAssetDetail();
  const { announce } = useMediaContext('Detail.Root');
  const { messages, format } = useMediaMessages();
  const element = useRender({
    defaultTagName: 'form',
    render,
    state: {
      dirty: detail.dirty,
      saving: detail.saving,
      conflict: detail.conflict !== null,
    } satisfies DetailRootState,
    props: mergeProps<'form'>(
      {
        'aria-label': messages.detail.title,
        'aria-busy': detail.saving || undefined,
        onSubmit: (event: React.SyntheticEvent) => {
          event.preventDefault();
          void detail.save().then((result) => {
            if (result.ok) announce(messages.detail.saved);
            else if (result.code === 'ASSET_CONFLICT' && detail.asset) {
              announce(
                messages.detail.conflict(
                  { name: assetName(detail.asset) },
                  format,
                ),
                'assertive',
              );
            }
          });
        },
      },
      rest,
      { children },
    ),
  });
  if (!detail.asset) return null;
  return (
    <DetailContext.Provider value={detail}>{element}</DetailContext.Provider>
  );
}

// --- Detail.Field ------------------------------------------------------------------

export type DetailFieldProps = UseRenderComponentProps<'input'> & {
  field: Exclude<DetailField, 'provenance'>;
};

/**
 * An `input` bound to one field of the draft (`originalName`,
 * `description`, `rights.credit`, `custom.<key>`, ...). Render a
 * `textarea` through `render` for longer text.
 */
export function DetailFieldInput(props: DetailFieldProps) {
  const { field, render, ...rest } = props;
  const detail = useDetailContext('Detail.Field');
  const current = detail.value(field);
  return useRender({
    defaultTagName: 'input',
    render,
    props: mergeProps<'input'>(
      {
        name: field,
        value: text(current),
        disabled: detail.saving,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          detail.set(field, event.currentTarget.value),
      },
      rest,
    ),
  });
}

// --- Detail.Provenance ------------------------------------------------------------------

export type DetailProvenanceProps = UseRenderComponentProps<'select'>;

/** A `select` of the asset's origin with the `filter.provenance` labels. */
export function DetailProvenance(props: DetailProvenanceProps) {
  const { render, ...rest } = props;
  const detail = useDetailContext('Detail.Provenance');
  const { messages } = useMediaMessages();
  return useRender({
    defaultTagName: 'select',
    render,
    props: mergeProps<'select'>(
      {
        name: 'provenance',
        'aria-label': messages.detail.provenance,
        value: text(detail.value('provenance')) || 'unknown',
        disabled: detail.saving,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
          detail.set('provenance', event.currentTarget.value),
        children: PROVENANCES.map((value) => (
          <option key={value} value={value}>
            {messages.filter.provenance[value]}
          </option>
        )),
      },
      rest,
    ),
  });
}

// --- Detail.Facts ------------------------------------------------------------------

export type DetailFactsProps = Omit<
  UseRenderComponentProps<'dl'>,
  'children'
> & {
  /** Replaces the default list. */
  children?: (facts: AssetFacts) => React.ReactNode;
};

/** The read-only facts (type, size, dimensions, dates) as a `dl`. */
export function DetailFacts(props: DetailFactsProps) {
  const { render, children, ...rest } = props;
  const detail = useDetailContext('Detail.Facts');
  const { messages, format } = useMediaMessages();
  const facts = detail.facts!;
  const asset = detail.asset!;
  const rows: [string, string][] = [
    [messages.detail.facts.type, facts.mimeType],
    [messages.detail.facts.size, format.bytes(facts.size)],
  ];
  if (facts.width && facts.height) {
    rows.push([
      messages.detail.facts.dimensions,
      messages.detail.dimensions(
        { width: facts.width, height: facts.height },
        format,
      ),
    ]);
  }
  rows.push([messages.detail.facts.created, format.date(facts.createdAt)]);
  rows.push([messages.detail.facts.updated, format.date(asset.updatedAt)]);
  if (facts.uploadedBy) {
    rows.push([messages.detail.facts.uploadedBy, facts.uploadedBy]);
  }
  return useRender({
    defaultTagName: 'dl',
    render,
    props: mergeProps<'dl'>(
      {
        children: children
          ? children(facts)
          : rows.map(([term, value]) => (
              <React.Fragment key={term}>
                <dt>{term}</dt>
                <dd>{value}</dd>
              </React.Fragment>
            )),
      },
      rest,
    ),
  });
}

// --- Detail.Save / Detail.Reset ----------------------------------------------------------

export type DetailSaveProps = UseRenderComponentProps<'button'>;

/** The submit `button`; `disabled` without changes or while saving. */
export function DetailSave(props: DetailSaveProps) {
  const { render, ...rest } = props;
  const detail = useDetailContext('Detail.Save');
  const { messages } = useMediaMessages();
  return useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'submit',
        disabled: !detail.dirty || detail.saving,
        children: detail.saving ? messages.detail.saving : messages.detail.save,
      },
      rest,
    ),
  });
}

export type DetailResetProps = UseRenderComponentProps<'button'>;

/** Discards the draft; `disabled` without changes. */
export function DetailReset(props: DetailResetProps) {
  const { render, ...rest } = props;
  const detail = useDetailContext('Detail.Reset');
  const { messages } = useMediaMessages();
  return useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'button',
        disabled: !detail.dirty || detail.saving,
        children: messages.detail.reset,
        onClick: detail.reset,
      },
      rest,
    ),
  });
}

// --- Detail.Error / Detail.Conflict ----------------------------------------------------------

export type DetailErrorProps = UseRenderComponentProps<'p'>;

/** The translated error of the last save, except conflicts; nothing otherwise. */
export function DetailError(props: DetailErrorProps) {
  const { render, ...rest } = props;
  const detail = React.useContext(DetailContext);
  const { messages } = useMediaMessages();
  const code = errorCodeOf(detail?.error);
  const element = useRender({
    defaultTagName: 'p',
    render,
    props: mergeProps<'p'>(
      { role: 'alert', children: mediaErrorMessage(messages, code) },
      rest,
    ),
  });
  if (!detail?.error || code === 'ASSET_CONFLICT') return null;
  return element;
}

export type DetailConflictProps = {
  children: (props: {
    /** The server's newer version. */
    theirs: MediaAsset;
    keepMine: () => void;
    takeTheirs: () => void;
  }) => React.ReactNode;
};

/**
 * Renders `children` while a save conflicts with a newer version: keep my
 * changes (saved over the newer version) or take theirs (draft dropped).
 */
export function DetailConflict(props: DetailConflictProps) {
  const detail = useDetailContext('Detail.Conflict');
  if (!detail.conflict) return null;
  return props.children({
    theirs: detail.conflict,
    keepMine: () => void detail.resolveConflict('mine'),
    takeTheirs: () => void detail.resolveConflict('theirs'),
  });
}

// --- Detail.Revisions ---------------------------------------------------------------------

export type DetailRevisionsProps = {
  children: (props: {
    revisions: MediaRevision[] | null;
    restore: (revisionId: string) => void;
  }) => React.ReactNode;
};

/** Loads the asset's earlier versions on mount and renders `children` with them. */
export function DetailRevisions(props: DetailRevisionsProps) {
  const detail = useDetailContext('Detail.Revisions');
  const { announce } = useMediaContext('Detail.Revisions');
  const { messages, format } = useMediaMessages();
  const assetId = detail.asset?.id;
  // Reload per asset only; `loadRevisions` changes with every store update.
  const load = React.useRef(detail.loadRevisions);
  load.current = detail.loadRevisions;
  React.useEffect(() => {
    if (assetId) load.current();
  }, [assetId]);
  return props.children({
    revisions: detail.revisions,
    restore: (revisionId) => {
      const name = detail.asset ? assetName(detail.asset) : '';
      void detail.restoreRevision(revisionId).then((result) => {
        if (result.ok) {
          announce(messages.detail.revisionRestored({ name }, format));
        }
      });
    },
  });
}

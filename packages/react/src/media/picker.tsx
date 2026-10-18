import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type { MediaMessagesContextValue } from './context';
import type { PickerConstraints, PickerDisabledReason } from './core/picker';
import type { MediaStoreState } from './core/store';
import type { MediaAsset } from './core/types';

import { mergeProps, useRender } from '../use-render';
import { useMediaContext, useMediaMessages } from './context';
import {
  aspectLabel,
  canConfirmPicker,
  pickerDisabledReason,
} from './core/picker';
import { useMediaItemContext } from './grid';
import { useSelector } from './use-store';

const PickerContext = React.createContext<PickerConstraints | null>(null);

/** The constraints of the enclosing `Picker.Root`, or `null` outside one. */
export function usePickerConstraints(): PickerConstraints | null {
  return React.useContext(PickerContext);
}

export type PickerRootProps = {
  constraints: PickerConstraints;
  children?: React.ReactNode;
};

/**
 * Applies picker constraints to the `Media.Root` it sits in: items show
 * why they cannot be chosen (`Picker.Reason`, `usePickerItem`) and
 * `Picker.Confirm` only accepts a valid choice. Pass `pickerFilter(...)`
 * as the root's filter and `intakeConstraintsOf(...)` to uploads so the
 * listing and the uploads follow the same rules. Renders no element.
 */
export function PickerRoot(props: PickerRootProps) {
  return (
    <PickerContext.Provider value={props.constraints}>
      {props.children}
    </PickerContext.Provider>
  );
}

const selectSelected = (state: MediaStoreState) => state.selection.selected;

/** The translated reason an asset is locked. */
export function pickerReasonText(
  reason: PickerDisabledReason,
  constraints: PickerConstraints,
  { messages, format }: MediaMessagesContextValue,
): string {
  const disabled = messages.picker.disabled;
  switch (reason) {
    case 'type':
      return disabled.type(
        { accepted: (constraints.accept ?? []).join(', ') },
        format,
      );
    case 'size':
      return disabled.size({ max: constraints.maxBytes ?? 0 }, format);
    case 'dimensions':
      return disabled.dimensions(
        {
          minWidth: constraints.minWidth ?? 0,
          minHeight: constraints.minHeight ?? 0,
        },
        format,
      );
    case 'aspect':
      return disabled.aspect(
        { ratio: aspectLabel(constraints.aspect?.ratio ?? 1) },
        format,
      );
    case 'max':
      return disabled.max({ max: constraints.max ?? 0 }, format);
  }
}

/**
 * Whether `asset` can be chosen in the enclosing `Picker.Root`, with the
 * reason and its text. Without a picker every asset is allowed.
 */
export function usePickerItem(asset: MediaAsset): {
  disabled: boolean;
  reason: PickerDisabledReason | null;
  text: string | null;
} {
  const constraints = usePickerConstraints();
  const { store } = useMediaContext('usePickerItem');
  const selected = useSelector(store, selectSelected, Object.is);
  const catalog = useMediaMessages();
  const reason = constraints
    ? pickerDisabledReason(asset, constraints, selected)
    : null;
  return {
    disabled: reason !== null,
    reason,
    text:
      reason && constraints
        ? pickerReasonText(reason, constraints, catalog)
        : null,
  };
}

export type PickerReasonProps = UseRenderComponentProps<'span'>;

/**
 * Inside `Media.Item`: why the asset cannot be chosen, or nothing. Give
 * the item `aria-disabled` from `usePickerItem` as well.
 */
export function PickerReason(props: PickerReasonProps) {
  const { render, ...rest } = props;
  const { asset } = useMediaItemContext('Picker.Reason');
  const item = usePickerItem(asset);
  const element = useRender({
    defaultTagName: 'span',
    render,
    props: mergeProps<'span'>({ children: item.text }, rest),
  });
  return item.text ? element : null;
}

export type PickerConfirmProps = Omit<
  UseRenderComponentProps<'button'>,
  'onClick'
> & {
  onConfirm: (assets: MediaAsset[]) => void;
};

/**
 * Confirms the choice with the selected assets in selection order;
 * `disabled` until the choice meets `min`/`max` and every chosen asset
 * passes the constraints.
 */
export function PickerConfirm(props: PickerConfirmProps) {
  const { onConfirm, render, ...rest } = props;
  const constraints = usePickerConstraints() ?? { mode: 'single' };
  const { store } = useMediaContext('Picker.Confirm');
  const selected = useSelector(store, selectSelected, Object.is);
  const { messages, format } = useMediaMessages();
  const state = store.getState();
  const assets = selected.flatMap((id) =>
    state.collection.byId[id] ? [state.collection.byId[id]] : [],
  );
  const valid =
    canConfirmPicker(constraints, selected) &&
    assets.length === selected.length &&
    assets.every(
      (asset) => pickerDisabledReason(asset, constraints, selected) === null,
    );
  return useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'button',
        disabled: !valid,
        children: messages.picker.confirm({ count: selected.length }, format),
        onClick: () => {
          if (valid) onConfirm(assets);
        },
      },
      rest,
    ),
  });
}

// --- openMediaPicker ---------------------------------------------------------------------

/** One open picker request, as `MediaPickerHost` renders it. */
export type MediaPickerRequest = {
  constraints: PickerConstraints;
  resolve: (assets: MediaAsset[]) => void;
  cancel: () => void;
};

type HostHandler = (request: MediaPickerRequest) => void;
const hosts: HostHandler[] = [];

/**
 * Opens the picker of the mounted `MediaPickerHost` (the last one mounted
 * wins) and resolves with the chosen assets, or `null` when cancelled.
 * Rejects when no host is mounted.
 */
export function openMediaPicker(
  constraints: PickerConstraints,
): Promise<MediaAsset[] | null> {
  const host = hosts.at(-1);
  if (!host) {
    return Promise.reject(
      new Error('openMediaPicker needs a mounted MediaPickerHost.'),
    );
  }
  return new Promise((resolve) => {
    host({
      constraints,
      resolve: (assets) => resolve(assets),
      cancel: () => resolve(null),
    });
  });
}

export type MediaPickerHostProps = {
  /** Renders the open request (a dialog with `Media.Root` and `Picker.Root`). */
  children: (request: MediaPickerRequest) => React.ReactNode;
};

/**
 * Mount once (in the editor shell) so that `openMediaPicker` works from
 * anywhere: a field control, a canvas drop target, a toolbar button. A new
 * request replaces an open one, which resolves with `null`.
 */
export function MediaPickerHost(props: MediaPickerHostProps) {
  const [request, setRequest] = React.useState<MediaPickerRequest | null>(null);
  const current = React.useRef<MediaPickerRequest | null>(null);
  React.useEffect(() => {
    const handler: HostHandler = (next) => {
      current.current?.cancel();
      const wrapped: MediaPickerRequest = {
        constraints: next.constraints,
        resolve: (assets) => {
          next.resolve(assets);
          current.current = null;
          setRequest(null);
        },
        cancel: () => {
          next.cancel();
          current.current = null;
          setRequest(null);
        },
      };
      current.current = wrapped;
      setRequest(wrapped);
    };
    hosts.push(handler);
    return () => {
      hosts.splice(hosts.indexOf(handler), 1);
      current.current?.cancel();
    };
  }, []);
  return request ? <>{props.children(request)}</> : null;
}

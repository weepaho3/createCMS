import * as React from 'react';

import type { UseRenderComponentProps } from '../use-render';
import type { CropPreset, FocalPoint, UsageCrop } from './core/image-edit';

import { mergeProps, useRender } from '../use-render';
import { useMediaMessages } from './context';
import {
  CENTER,
  cropAspect,
  cropStyles,
  DEFAULT_CROP_PRESETS,
  defaultCrop,
  focalFromPointer,
  focalObjectPosition,
  focalPercent,
  isFullCrop,
  normalizeCrop,
  nudgeFocal,
  zoomCrop,
} from './core/image-edit';

/** The image an editor part works on. */
export type EditableImage = { src: string; width: number; height: number };

function useControlled<T>(
  value: T | undefined,
  defaultValue: T,
  onChange: ((next: T) => void) | undefined,
): [T, (next: T) => void] {
  const [inner, setInner] = React.useState(defaultValue);
  const current = value === undefined ? inner : value;
  const set = React.useCallback(
    (next: T) => {
      if (value === undefined) setInner(next);
      onChange?.(next);
    },
    [value, onChange],
  );
  return [current, set];
}

const ARROWS: Record<string, 'left' | 'right' | 'up' | 'down'> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

// --- FocalPoint ---------------------------------------------------------------------

type FocalContextValue = {
  image: EditableImage;
  value: FocalPoint;
  set: (next: FocalPoint) => void;
  commit: (next: FocalPoint) => void;
};

const FocalContext = React.createContext<FocalContextValue | null>(null);

function useFocal(name: string): FocalContextValue {
  const value = React.useContext(FocalContext);
  if (!value) throw new Error(`${name} must be used within FocalPoint.Root.`);
  return value;
}

export type FocalPointRootProps = Omit<
  UseRenderComponentProps<'div'>,
  'defaultValue'
> & {
  image: EditableImage;
  value?: FocalPoint | null;
  defaultValue?: FocalPoint | null;
  /** Every move, for live previews. */
  onValueChange?: (point: FocalPoint) => void;
  /** After a drag ends or a key moved the point: the moment to save (`setFocalPoint`). */
  onValueCommit?: (point: FocalPoint) => void;
};

/**
 * The image with a draggable focal point: a click or drag places it,
 * `FocalPoint.Handle` moves it by keyboard. The value is a fraction of
 * width and height; renderers use it as `object-position`.
 */
export function FocalPointRoot(props: FocalPointRootProps) {
  const {
    image,
    value: valueProp,
    defaultValue,
    onValueChange,
    onValueCommit,
    render,
    children,
    ...rest
  } = props;
  const [value, set] = useControlled<FocalPoint>(
    valueProp === null ? CENTER : valueProp,
    defaultValue ?? CENTER,
    onValueChange,
  );
  const dragging = React.useRef(false);
  const last = React.useRef(value);
  last.current = value;
  const ctx = React.useMemo(
    () => ({
      image,
      value,
      set,
      commit: (next: FocalPoint) => {
        set(next);
        onValueCommit?.(next);
      },
    }),
    [image, value, set, onValueCommit],
  );
  const place = (event: React.PointerEvent<HTMLElement>) =>
    set(
      focalFromPointer(
        event.clientX,
        event.clientY,
        event.currentTarget.getBoundingClientRect(),
      ),
    );
  const element = useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(
      {
        style: { position: 'relative', touchAction: 'none' },
        onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
          if (event.button !== 0) return;
          dragging.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          place(event);
        },
        onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
          if (dragging.current) place(event);
        },
        onPointerUp: () => {
          if (!dragging.current) return;
          dragging.current = false;
          onValueCommit?.(last.current);
        },
        onPointerCancel: () => {
          dragging.current = false;
        },
      },
      rest,
      { children },
    ),
  });
  return <FocalContext.Provider value={ctx}>{element}</FocalContext.Provider>;
}

export type FocalPointHandleProps = UseRenderComponentProps<'div'>;

/**
 * The marker as a focusable `role="slider"`: arrows move it 1 percent,
 * with Shift 10 percent, Home centers it. Positioned absolutely at the
 * point; style its look.
 */
export function FocalPointHandle(props: FocalPointHandleProps) {
  const { render, ...rest } = props;
  const focal = useFocal('FocalPoint.Handle');
  const { messages, format } = useMediaMessages();
  const percent = focalPercent(focal.value);
  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(
      {
        role: 'slider',
        tabIndex: 0,
        'aria-label': messages.focal.label,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': percent.x,
        'aria-valuetext': messages.focal.value(percent, format),
        style: {
          position: 'absolute',
          left: `${percent.x}%`,
          top: `${percent.y}%`,
          transform: 'translate(-50%, -50%)',
        },
        onKeyDown: (event: React.KeyboardEvent) => {
          const direction = ARROWS[event.key];
          if (direction) {
            event.preventDefault();
            focal.commit(nudgeFocal(focal.value, direction, event.shiftKey));
          } else if (event.key === 'Home') {
            event.preventDefault();
            focal.commit(CENTER);
          }
        },
      },
      rest,
    ),
  });
}

export type FocalPointPreviewProps = UseRenderComponentProps<'img'>;

/**
 * The image cropped by `object-fit: cover` at the focal point; give it a
 * size (several previews show different aspect ratios).
 */
export function FocalPointPreview(props: FocalPointPreviewProps) {
  const { render, ...rest } = props;
  const focal = useFocal('FocalPoint.Preview');
  return useRender({
    defaultTagName: 'img',
    render,
    props: mergeProps<'img'>(
      {
        src: focal.image.src,
        alt: '',
        style: {
          objectFit: 'cover',
          objectPosition: focalObjectPosition(focal.value),
        },
      },
      rest,
    ),
  });
}

// --- Crop --------------------------------------------------------------------------

type CropContextValue = {
  image: EditableImage;
  crop: UsageCrop;
  presets: readonly CropPreset[];
  /** The selected preset id, `free` or `original`. */
  aspect: string;
  zoom: number;
  focal: FocalPoint;
  setCrop: (next: UsageCrop) => void;
  setAspect: (id: string) => void;
  setZoom: (zoom: number) => void;
  reset: () => void;
};

const CropContext = React.createContext<CropContextValue | null>(null);

function useCrop(name: string): CropContextValue {
  const value = React.useContext(CropContext);
  if (!value) throw new Error(`${name} must be used within Crop.Root.`);
  return value;
}

const FULL: UsageCrop = { x: 0, y: 0, width: 1, height: 1 };

export type CropRootProps = {
  image: EditableImage;
  /** The crop of this use, in fractions; `null` is the whole image. */
  value?: UsageCrop | null;
  defaultValue?: UsageCrop | null;
  /** `null` when the crop covers the whole image. */
  onValueChange?: (crop: UsageCrop | null) => void;
  /** Aspect presets offered by `Crop.Aspect` (default `DEFAULT_CROP_PRESETS`). */
  presets?: readonly CropPreset[];
  /** The preset to start with; `free` (default) or `original`. */
  defaultAspect?: string;
  /** Centers new crops on this point (the asset's focal point). */
  focal?: FocalPoint | null;
  children?: React.ReactNode;
};

/**
 * The crop of one image use. Crops are fractions of the original, stored
 * in the reference (`AssetRef.crop`), never in the asset; a different use
 * of the same asset keeps its own crop. Renders no element.
 */
export function CropRoot(props: CropRootProps) {
  const {
    image,
    value,
    defaultValue,
    onValueChange,
    presets = DEFAULT_CROP_PRESETS,
    defaultAspect = 'free',
    focal,
    children,
  } = props;
  const [crop, setCropRaw] = useControlled<UsageCrop>(
    value === null ? FULL : value,
    defaultValue ?? FULL,
    React.useCallback(
      (next: UsageCrop) => onValueChange?.(isFullCrop(next) ? null : next),
      [onValueChange],
    ),
  );
  const [aspect, setAspectId] = React.useState(defaultAspect);
  const [zoom, setZoomValue] = React.useState(1);
  const center = focal ?? CENTER;
  const ratioOf = React.useCallback(
    (id: string) =>
      id === 'original'
        ? image.width / image.height
        : presets.find((preset) => preset.id === id)?.aspect,
    [image, presets],
  );
  const ctx = React.useMemo<CropContextValue>(
    () => ({
      image,
      crop,
      presets,
      aspect,
      zoom,
      focal: center,
      setCrop: (next) => setCropRaw(normalizeCrop(next)),
      setAspect: (id) => {
        setAspectId(id);
        setZoomValue(1);
        const ratio = ratioOf(id);
        if (ratio) {
          setCropRaw(defaultCrop(ratio, image.width, image.height, center));
        }
      },
      setZoom: (next) => {
        setZoomValue(next);
        const ratio = ratioOf(aspect);
        const base = ratio
          ? defaultCrop(ratio, image.width, image.height, center)
          : FULL;
        setCropRaw(
          zoomCrop(base, next, {
            x: crop.x + crop.width / 2,
            y: crop.y + crop.height / 2,
          }),
        );
      },
      reset: () => {
        setAspectId(defaultAspect);
        setZoomValue(1);
        setCropRaw(FULL);
      },
    }),
    [
      image,
      crop,
      presets,
      aspect,
      zoom,
      center,
      setCropRaw,
      ratioOf,
      defaultAspect,
    ],
  );
  return <CropContext.Provider value={ctx}>{children}</CropContext.Provider>;
}

export type CropAreaProps = UseRenderComponentProps<'div'>;

/**
 * The whole image with the crop as an absolutely placed box
 * (`data-crop-box`); dragging the box moves the crop. Arrow keys on the
 * focused area move it 1 percent, with Shift 10 percent.
 */
export function CropArea(props: CropAreaProps) {
  const { render, children, ...rest } = props;
  const ctx = useCrop('Crop.Area');
  const { messages } = useMediaMessages();
  const drag = React.useRef<{
    x: number;
    y: number;
    crop: UsageCrop;
    box: DOMRect;
  } | null>(null);
  const { crop } = ctx;
  const pct = (v: number) => `${v * 100}%`;
  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(
      {
        role: 'group',
        tabIndex: 0,
        'aria-label': messages.crop.label,
        style: { position: 'relative', touchAction: 'none' },
        onKeyDown: (event: React.KeyboardEvent) => {
          const direction = ARROWS[event.key];
          if (!direction) return;
          event.preventDefault();
          const step = event.shiftKey ? 0.1 : 0.01;
          ctx.setCrop({
            ...crop,
            x:
              crop.x +
              (direction === 'left' ? -step : direction === 'right' ? step : 0),
            y:
              crop.y +
              (direction === 'up' ? -step : direction === 'down' ? step : 0),
          });
        },
        onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            crop,
            box: event.currentTarget.getBoundingClientRect(),
          };
        },
        onPointerMove: (event: React.PointerEvent) => {
          const start = drag.current;
          if (!start || start.box.width <= 0 || start.box.height <= 0) return;
          ctx.setCrop({
            ...start.crop,
            x: start.crop.x + (event.clientX - start.x) / start.box.width,
            y: start.crop.y + (event.clientY - start.y) / start.box.height,
          });
        },
        onPointerUp: () => {
          drag.current = null;
        },
        onPointerCancel: () => {
          drag.current = null;
        },
      },
      rest,
      {
        children: (
          <>
            <img
              src={ctx.image.src}
              alt=""
              draggable={false}
              style={{ display: 'block', width: '100%', height: 'auto' }}
            />
            <div
              data-crop-box=""
              style={{
                position: 'absolute',
                left: pct(crop.x),
                top: pct(crop.y),
                width: pct(crop.width),
                height: pct(crop.height),
                cursor: 'move',
              }}
            />
            {children}
          </>
        ),
      },
    ),
  });
}

export type CropZoomProps = UseRenderComponentProps<'input'>;

/** An `input type="range"` from 1 to 3 that zooms the crop around its center. */
export function CropZoom(props: CropZoomProps) {
  const { render, ...rest } = props;
  const ctx = useCrop('Crop.Zoom');
  const { messages } = useMediaMessages();
  return useRender({
    defaultTagName: 'input',
    render,
    props: mergeProps<'input'>(
      {
        type: 'range',
        min: 1,
        max: 3,
        step: 0.01,
        value: ctx.zoom,
        'aria-label': messages.crop.zoom,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
          ctx.setZoom(Number(event.currentTarget.value)),
      },
      rest,
    ),
  });
}

export type CropAspectProps = Omit<
  UseRenderComponentProps<'div'>,
  'children'
> & {
  /** Renders one option; defaults to a radio with its label. */
  children?: (option: {
    id: string;
    label: string;
    checked: boolean;
    select: () => void;
  }) => React.ReactNode;
};

/**
 * A `radiogroup` of `free`, `original` and the presets; choosing one sets
 * the largest crop of that aspect around the focal point.
 */
export function CropAspect(props: CropAspectProps) {
  const { render, children, ...rest } = props;
  const ctx = useCrop('Crop.Aspect');
  const { messages } = useMediaMessages();
  const name = React.useId();
  const options = [
    { id: 'free', label: messages.crop.free },
    { id: 'original', label: messages.crop.original },
    ...ctx.presets.map((preset) => ({ id: preset.id, label: preset.label })),
  ];
  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(
      {
        role: 'radiogroup',
        'aria-label': messages.crop.aspect,
        children: options.map((option) => {
          const checked = ctx.aspect === option.id;
          const select = () => ctx.setAspect(option.id);
          return (
            <React.Fragment key={option.id}>
              {children ? (
                children({ ...option, checked, select })
              ) : (
                <label>
                  <input
                    type="radio"
                    name={name}
                    checked={checked}
                    onChange={select}
                  />
                  {option.label}
                </label>
              )}
            </React.Fragment>
          );
        }),
      },
      rest,
    ),
  });
}

export type CropInputProps = UseRenderComponentProps<'input'> & {
  /** The crop edge or size, edited in pixels of the original. */
  field: 'x' | 'y' | 'width' | 'height';
};

/** A number `input` for one crop value in pixels of the original image. */
export function CropInput(props: CropInputProps) {
  const { field, render, ...rest } = props;
  const ctx = useCrop('Crop.Input');
  const { messages } = useMediaMessages();
  const scale =
    field === 'x' || field === 'width' ? ctx.image.width : ctx.image.height;
  return useRender({
    defaultTagName: 'input',
    render,
    props: mergeProps<'input'>(
      {
        type: 'number',
        inputMode: 'numeric',
        min: field === 'width' || field === 'height' ? 1 : 0,
        max: scale,
        value: Math.round(ctx.crop[field] * scale),
        'aria-label': messages.crop[field],
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          const pixels = Number(event.currentTarget.value);
          if (!Number.isFinite(pixels)) return;
          ctx.setCrop({ ...ctx.crop, [field]: pixels / scale });
        },
      },
      rest,
    ),
  });
}

export type CropResetProps = UseRenderComponentProps<'button'>;

/** Back to the whole image; `disabled` while uncropped. */
export function CropReset(props: CropResetProps) {
  const { render, ...rest } = props;
  const ctx = useCrop('Crop.Reset');
  const { messages } = useMediaMessages();
  return useRender({
    defaultTagName: 'button',
    render,
    props: mergeProps<'button'>(
      {
        type: 'button',
        disabled: isFullCrop(ctx.crop),
        children: messages.crop.reset,
        onClick: ctx.reset,
      },
      rest,
    ),
  });
}

export type CropPreviewProps = UseRenderComponentProps<'div'>;

/** The cropped image in a box of the crop's aspect ratio. */
export function CropPreview(props: CropPreviewProps) {
  const { render, ...rest } = props;
  const ctx = useCrop('Crop.Preview');
  const styles = cropStyles(ctx.crop, ctx.image);
  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(
      {
        style: {
          position: 'relative',
          overflow: 'hidden',
          aspectRatio: String(
            styles.aspectRatio ??
              cropAspect(ctx.crop, ctx.image.width, ctx.image.height),
          ),
        },
        children: <img src={ctx.image.src} alt="" style={styles.image} />,
      },
      rest,
    ),
  });
}

/** The crop editor state of the enclosing `Crop.Root`. */
export function useCropEditor(): CropContextValue & {
  /** Whether the crop is narrower than the selected preset's `minWidth`. */
  tooSmall: boolean;
} {
  const ctx = useCrop('useCropEditor');
  const preset = ctx.presets.find((p) => p.id === ctx.aspect);
  return {
    ...ctx,
    tooSmall:
      !!preset?.minWidth && ctx.crop.width * ctx.image.width < preset.minWidth,
  };
}

import type { JsonValue } from '../document/types';
import type { LinkValue } from '../schema/types';
import type { RichTextDoc, RichTextSchema } from './types';

/** Formatting commands of a mounted rich text editor. */
export type RichTextCommands = {
  /** Toggles a mark (`bold`, `italic`, ...) on the selection. */
  toggleMark(name: string): void;
  /** Sets the link on the selection; `null` removes it. */
  setLink(value: LinkValue | { href: string } | null): void;
  /** Turns the selected blocks into `type` (`paragraph`, `heading` with `{ level }`, ...). */
  setNode(type: string, attrs?: Record<string, JsonValue>): void;
  /** True when the selection carries the mark or sits in the node. */
  isActive(name: string, attrs?: Record<string, JsonValue>): boolean;
};

/** One entry of a suggestion list (`{{variable}}` completion). */
export type RichTextSuggestionItem = {
  label: string;
  /** Replaces the trigger and the typed query. */
  insertText: string;
  description?: string;
};

/** An open suggestion list, for the UI that shows it. */
export type RichTextSuggestionState = {
  /** What was typed after the trigger. */
  query: string;
  items: readonly RichTextSuggestionItem[];
  /** The highlighted item. */
  index: number;
  /** Where the caret is, in client coordinates of the editor's document. */
  rect: { x: number; y: number; width: number; height: number } | null;
  /** Inserts an item. */
  select(index: number): void;
};

/**
 * Completion after a trigger (`{{` for variables): the editor tracks the
 * query and the keys (arrows, Enter, Tab, Escape); the UI renders the
 * state it reports.
 */
export type RichTextSuggestion = {
  /** Default `{{`. */
  char?: string;
  items(query: string): readonly RichTextSuggestionItem[];
  /** The open list, or `null` when it closes. */
  onState(state: RichTextSuggestionState | null): void;
};

/** How a rich text editor mounts into an element. */
export type RichTextMountOptions = {
  value: RichTextDoc;
  /** What the field allows; the editor offers nothing else. */
  schema: RichTextSchema;
  /** Every edit, with the whole new value. */
  onChange(value: RichTextDoc): void;
  /** Selection or active formatting changed (toolbars re-read `isActive`). */
  onSelectionChange?(): void;
  onFocus?(): void;
  onBlur?(): void;
  /** Places the caret at this client point after mounting (click to edit). */
  caretFrom?: { x: number; y: number };
  /** Default `true`. */
  editable?: boolean;
  placeholder?: string;
  /** Attributes for the editable element (`id`, `aria-*`). */
  attributes?: Record<string, string>;
  suggestion?: RichTextSuggestion;
};

/** A mounted editor. */
export type RichTextHandle = {
  /** Replaces the content without an `onChange` (undo, remote edits). */
  setValue(value: RichTextDoc): void;
  setEditable(editable: boolean): void;
  focus(): void;
  destroy(): void;
  readonly commands: RichTextCommands;
};

/**
 * Plugs a rich text editor into the form and the canvas
 * (`Editor.Root richText={adapter}`). The editor keeps no history of its
 * own: undo runs through the editor store.
 */
export type RichTextAdapter = {
  mount(el: HTMLElement, options: RichTextMountOptions): RichTextHandle;
};

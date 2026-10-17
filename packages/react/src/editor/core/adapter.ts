import type { EditorDocument, JsonValue, Op } from './document';
import type { Field, MediaValue } from './schema';

/** Why an adapter call failed; the editor maps each kind to its own state. */
export type EditorAdapterErrorKind =
  | 'validation'
  | 'conflict'
  | 'network'
  | 'permission'
  | 'not-found'
  | 'unknown';

/** The error every adapter throws, so the editor can react to `kind`. */
export class EditorAdapterError extends Error {
  readonly kind: EditorAdapterErrorKind;
  /** Adapter-specific detail (server code, field findings, ...). */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    kind: EditorAdapterErrorKind,
    message: string,
    details: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'EditorAdapterError';
    this.kind = kind;
    this.details = details;
  }
}

/** Loads and saves whole documents. `baseVersion` guards against lost updates. */
export type PersistenceAdapter = {
  load(id: string): Promise<EditorDocument>;
  save(
    id: string,
    doc: EditorDocument,
    ctx: { ops: readonly Op[]; baseVersion?: string; message?: string },
  ): Promise<{ version: string }>;
  publish?(id: string, doc: EditorDocument): Promise<void>;
};

/** Data sources for field controls (assets, documents, variables, ...); shape is adapter-defined. */
export type FieldSources = Readonly<Record<string, unknown>>;

/** Everything the editor needs from a content backend. */
export type EditorAdapter = PersistenceAdapter & {
  /** Loads a referenced document for display. */
  resolveReference?(ref: {
    collection: string;
    id: string;
  }): Promise<EditorDocument>;
  /** Display resolvers per field kind (links to hrefs, variables filled in, ...). */
  resolveField?: Readonly<
    Record<string, (value: JsonValue, spec: Field) => unknown>
  >;
  fieldSources?: FieldSources;
  uploadMedia?(file: Blob): Promise<MediaValue>;
  canPlace?(childType: string, parentType: string, slot: string): boolean;
};

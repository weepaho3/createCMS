import type {
  BlockProperty,
  LinkKind,
  ListElementSpec,
} from '@createcms/schema';

import type { AnyEditorSchema } from './types';

import { propertiesOf } from './fields';

export type FieldErrorCode =
  | 'required'
  | 'type'
  | 'format'
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'min'
  | 'max'
  | 'minItems'
  | 'maxItems'
  | 'option'
  | 'linkKind'
  | 'linkCollection'
  | 'linkTarget';

/**
 * One validation finding. `code` is stable (map it to your own messages);
 * `message` is a plain English fallback. `index` is set for list elements.
 */
export type FieldError = {
  code: FieldErrorCode;
  message: string;
  index?: number;
};

const ALL_LINK_KINDS: readonly LinkKind[] = [
  'internal',
  'external',
  'email',
  'phone',
];

// Approximation of core's `z.iso.datetime()`: UTC (`Z`), seconds optional.
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The target string of a link value for its kind, or `undefined` for an unknown kind. */
function linkTarget(link: Record<string, unknown>): unknown {
  switch (link.kind) {
    case 'internal':
      return link.rootId;
    case 'external':
      return link.url;
    case 'email':
      return link.email;
    case 'phone':
      return link.phone;
    default:
      return undefined;
  }
}

/**
 * Whether a value counts as "empty" for a `required` check: `null`/`undefined`,
 * a blank string, an empty list, or a link without a real target. `0` and
 * `false` are values, not gaps. Stricter than the server on blank strings and
 * empty lists — on purpose: this gates Save/Publish in the editor.
 */
export function isEmptyValue(spec: BlockProperty, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (spec.type === 'list') return Array.isArray(value) && value.length === 0;
  if (spec.type === 'link') {
    if (!isRecord(value)) return true;
    const target = linkTarget(value);
    return typeof target !== 'string' || target.trim() === '';
  }
  return false;
}

/**
 * Validates one value against its property spec — required, type, and the
 * declarative constraints (`minLength`/`maxLength`/`pattern`, `min`/`max`,
 * list `min`/`max` length, `select` options, link kinds/collections/target).
 * Mirrors the rules core enforces with zod on the write path, minus zod; the
 * server stays authoritative — this is the client-side pre-check.
 */
export function validateField(
  spec: BlockProperty,
  value: unknown,
): FieldError[] {
  // Absent = no value. Present values are checked like the server checks them;
  // the required gate alone is stricter (blank / empty / target-less = missing).
  if (value === null || value === undefined) {
    return spec.required === true ? [required()] : [];
  }
  if (spec.required === true && isEmptyValue(spec, value)) return [required()];

  switch (spec.type) {
    case 'string':
    case 'richText':
    case 'number':
    case 'boolean':
    case 'date':
    case 'image':
    case 'reference':
    case 'select':
      return validateScalar(spec, value);
    case 'link':
      return validateLink(spec, value);
    case 'list': {
      if (!Array.isArray(value)) return [type('a list')];
      const errors: FieldError[] = [];
      if (typeof spec.min === 'number' && value.length < spec.min) {
        errors.push({
          code: 'minItems',
          message: `Must have at least ${spec.min} item(s).`,
        });
      }
      if (typeof spec.max === 'number' && value.length > spec.max) {
        errors.push({
          code: 'maxItems',
          message: `Must have at most ${spec.max} item(s).`,
        });
      }
      for (const [index, element] of value.entries()) {
        for (const error of validateScalar(spec.of, element)) {
          errors.push({ ...error, index });
        }
      }
      return errors;
    }
  }
}

/** Scalar / select rules shared by top-level specs and list elements. */
function validateScalar(
  spec:
    | Exclude<BlockProperty, { type: 'link' } | { type: 'list' }>
    | ListElementSpec,
  value: unknown,
): FieldError[] {
  switch (spec.type) {
    case 'string':
    case 'richText': {
      if (typeof value !== 'string') return [type('text')];
      const errors: FieldError[] = [];
      if (typeof spec.minLength === 'number' && value.length < spec.minLength) {
        errors.push({
          code: 'minLength',
          message: `Must be at least ${spec.minLength} characters.`,
        });
      }
      if (typeof spec.maxLength === 'number' && value.length > spec.maxLength) {
        errors.push({
          code: 'maxLength',
          message: `Must be at most ${spec.maxLength} characters.`,
        });
      }
      if (
        typeof spec.pattern === 'string' &&
        !new RegExp(spec.pattern).test(value)
      ) {
        errors.push({ code: 'pattern', message: 'Has an invalid format.' });
      }
      return errors;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return [type('a number')];
      }
      const errors: FieldError[] = [];
      if (typeof spec.min === 'number' && value < spec.min) {
        errors.push({ code: 'min', message: `Must be at least ${spec.min}.` });
      }
      if (typeof spec.max === 'number' && value > spec.max) {
        errors.push({ code: 'max', message: `Must be at most ${spec.max}.` });
      }
      return errors;
    }
    case 'boolean':
      return typeof value === 'boolean' ? [] : [type('true or false')];
    case 'date':
      if (typeof value !== 'string') return [type('a date')];
      return ISO_DATETIME.test(value) && !Number.isNaN(Date.parse(value))
        ? []
        : [{ code: 'format', message: 'Must be an ISO-8601 datetime (UTC).' }];
    case 'image':
    case 'reference':
      return typeof value === 'string' ? [] : [type('an id')];
    case 'select': {
      if (typeof value !== 'string') return [type('an option')];
      return spec.options.some((option) => option.value === value)
        ? []
        : [{ code: 'option', message: 'Must be one of the options.' }];
    }
  }
}

function validateLink(
  spec: Extract<BlockProperty, { type: 'link' }>,
  value: unknown,
): FieldError[] {
  if (!isRecord(value)) return [type('a link')];
  const kinds = spec.allowedKinds?.length ? spec.allowedKinds : ALL_LINK_KINDS;
  if (!kinds.includes(value.kind as LinkKind)) {
    return [{ code: 'linkKind', message: 'This link kind is not allowed.' }];
  }
  const errors: FieldError[] = [];
  if (
    value.kind === 'internal' &&
    spec.allowedCollections?.length &&
    !spec.allowedCollections.includes(value.collection as string)
  ) {
    errors.push({
      code: 'linkCollection',
      message: 'Links to this collection are not allowed.',
    });
  }
  const target = linkTarget(value);
  if (typeof target !== 'string' || target.trim() === '') {
    errors.push({ code: 'linkTarget', message: 'The link needs a target.' });
  }
  return errors;
}

const required = (): FieldError => ({
  code: 'required',
  message: 'This field is required.',
});
const type = (expected: string): FieldError => ({
  code: 'type',
  message: `Must be ${expected}.`,
});

/** A `required` property left empty on one node (block or root). */
export type MissingRequiredField = {
  blockId: string;
  blockType: string;
  key: string;
  label: string;
};

/** The minimum a node must carry for the required scan (a store node or a flattened tree node). */
export type MissingRequiredNode = {
  readonly id: string;
  readonly type: string;
  readonly properties: Record<string, unknown>;
};

/**
 * Every `required` property left empty across the given nodes — blocks and the
 * root (`type === 'root'` reads the root's fields) — for gating Save/Publish.
 * Node order, then definition order. Uses {@link isEmptyValue}, so a blank
 * string, an empty list and a link without a target all count as missing.
 */
export function missingRequired(
  schema: AnyEditorSchema,
  nodes: Iterable<MissingRequiredNode>,
): MissingRequiredField[] {
  const missing: MissingRequiredField[] = [];
  for (const node of nodes) {
    const specs = propertiesOf(schema, node.type);
    for (const [key, spec] of Object.entries(specs)) {
      if (spec.required === true && isEmptyValue(spec, node.properties[key])) {
        missing.push({
          blockId: node.id,
          blockType: node.type,
          key,
          label: spec.label,
        });
      }
    }
  }
  return missing;
}

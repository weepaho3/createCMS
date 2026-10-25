import type { EditorDocument, JsonValue, NodeData } from '../document';
import type { RichTextNode } from '../richtext/types';
import type { StandardSchemaV1 } from './standard-schema';
import type {
  AnyComponentDef,
  AnyEditorSchema,
  Field,
  FieldContext,
  LinkKind,
  SlotSpec,
} from './types';

import { richTextToPlainText } from '../richtext/convert';
import { isRichTextDoc, richTextSchemaOf } from '../richtext/schema';
import { validateRichText } from '../richtext/validate';
import { componentOf, fieldsOf } from './fields';
import { slotAccepts } from './placement';
import { isLocalizedValue, isResponsiveValue } from './responsive';
import { isFieldVisible, resolveFields } from './visibility';

export type FieldErrorCode =
  | 'required'
  | 'type'
  | 'format'
  | 'minLength'
  | 'maxLength'
  | 'pattern'
  | 'min'
  | 'max'
  | 'step'
  | 'minItems'
  | 'maxItems'
  | 'option'
  | 'linkKind'
  | 'linkCollection'
  | 'linkTarget'
  | 'responsive'
  | 'localized'
  | 'richTextNode'
  | 'richTextMark'
  | 'richTextLinkProtocol'
  | 'richTextStructure';

/**
 * One finding of the built-in rules for one value. `code` is stable; map it
 * to your own messages. `params` carries the numbers a message needs (`min`,
 * `max`, `expected`, ...). `path` points into the value: a list index, an
 * object key, a breakpoint or locale; `[]` for the value itself.
 */
export type FieldError = {
  code: FieldErrorCode;
  path: (string | number)[];
  params?: Record<string, JsonValue>;
};

/** `error` blocks saving or publishing; `warning` only informs. */
export type ValidationSeverity = 'error' | 'warning';

/** Structural codes reported by {@link validateDocument}. */
export type StructureErrorCode =
  | 'duplicateId'
  | 'unknownType'
  | 'unknownSlot'
  | 'placement'
  | 'slotMin'
  | 'slotMax';

/**
 * One finding for a document. `path` starts with the node id; prop findings
 * continue with the prop key and the {@link FieldError} path, slot findings
 * with `'$slots'` and the slot name. `code: 'schema'` comes from a Standard
 * Schema validator; its own text is in `params.message`.
 */
export type ValidationIssue = {
  code: FieldErrorCode | StructureErrorCode | 'schema';
  path: (string | number)[];
  params?: Record<string, JsonValue>;
  severity: ValidationSeverity;
};

/** `edit` while authoring, `publish` before going live (stricter on slot sizes). */
export type ValidationPhase = 'edit' | 'publish';

export type ValidateNodeOptions = {
  phase?: ValidationPhase;
  /** Defaults to a context without ancestors or metadata. */
  ctx?: FieldContext;
  /**
   * Check `required` on hidden fields when publishing. Default `true`: a
   * required value stays required even while its field is hidden.
   */
  hiddenRequiredOnPublish?: boolean;
};

const ALL_LINK_KINDS: readonly LinkKind[] = [
  'internal',
  'external',
  'email',
  'phone',
];

// Approximation of `z.iso.datetime()`: UTC (`Z`), seconds optional.
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

/** Images and rules count as content of a rich text value. */
const hasNonText = (node: RichTextNode): boolean =>
  node.type === 'image' ||
  node.type === 'horizontalRule' ||
  (node.content ?? []).some(hasNonText);

const blank = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim() === '';

/**
 * Whether a value counts as empty for a `required` check: `null`/`undefined`,
 * a blank string, an empty list (or empty multiple select), a link without a
 * target, media without an asset id, a reference without an id. `0` and
 * `false` are values. Stricter than a plain presence check on purpose: this
 * gates saving and publishing.
 */
export function isEmptyValue(field: Field, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (!isRecord(value)) return false;
  if (field.type === 'link') return blank(linkTarget(value));
  if (field.type === 'media') return blank(value.assetId);
  if (field.type === 'reference') return blank(value.id);
  if (field.type === 'richText' && isRichTextDoc(value)) {
    return (
      richTextToPlainText(value).trim() === '' &&
      !(value.content ?? []).some(hasNonText)
    );
  }
  return false;
}

/**
 * Validates one value against its field with the built-in rules: required,
 * type, and the declarative constraints. Responsive and localized wrappers
 * are checked entry by entry and are rejected on fields that do not declare
 * `responsive` / `localized`. Synchronous; `validate` schemas run in
 * {@link validateDocument}.
 */
export function validateField(field: Field, value: unknown): FieldError[] {
  if (isResponsiveValue(value)) {
    if (!field.responsive) return [{ code: 'responsive', path: [] }];
    return Object.entries(value.$r).flatMap(([breakpoint, entry]) =>
      prefix(validatePlain(field, entry), ['$r', breakpoint]),
    );
  }
  if (isLocalizedValue(value)) {
    if (!field.localized) return [{ code: 'localized', path: [] }];
    return Object.entries(value.$l).flatMap(([locale, entry]) =>
      prefix(validateField({ ...field, localized: false }, entry), [
        '$l',
        locale,
      ]),
    );
  }
  return validatePlain(field, value);
}

function validatePlain(field: Field, value: unknown): FieldError[] {
  if (value === null || value === undefined) {
    return field.required === true ? [error('required')] : [];
  }
  if (field.required === true && isEmptyValue(field, value)) {
    return [error('required')];
  }
  switch (field.type) {
    case 'richText': {
      if (!isRichTextDoc(value)) return [typeError('richText')];
      const errors: FieldError[] = validateRichText(
        value,
        richTextSchemaOf(field),
      );
      const length = richTextToPlainText(value).length;
      if (typeof field.minLength === 'number' && length < field.minLength) {
        errors.push(error('minLength', { min: field.minLength }));
      }
      if (typeof field.maxLength === 'number' && length > field.maxLength) {
        errors.push(error('maxLength', { max: field.maxLength }));
      }
      return errors;
    }
    case 'text':
    case 'textarea': {
      if (typeof value !== 'string') return [typeError('text')];
      const errors: FieldError[] = [];
      if (
        typeof field.minLength === 'number' &&
        value.length < field.minLength
      ) {
        errors.push(error('minLength', { min: field.minLength }));
      }
      if (
        typeof field.maxLength === 'number' &&
        value.length > field.maxLength
      ) {
        errors.push(error('maxLength', { max: field.maxLength }));
      }
      if (
        typeof field.pattern === 'string' &&
        !new RegExp(field.pattern).test(value)
      ) {
        errors.push(error('pattern', { pattern: field.pattern }));
      }
      return errors;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return [typeError('number')];
      }
      const errors: FieldError[] = [];
      if (typeof field.min === 'number' && value < field.min) {
        errors.push(error('min', { min: field.min }));
      }
      if (typeof field.max === 'number' && value > field.max) {
        errors.push(error('max', { max: field.max }));
      }
      if (typeof field.step === 'number' && field.step > 0) {
        const steps = (value - (field.min ?? 0)) / field.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-9) {
          errors.push(error('step', { step: field.step }));
        }
      }
      return errors;
    }
    case 'boolean':
      return typeof value === 'boolean' ? [] : [typeError('boolean')];
    case 'date':
      if (typeof value !== 'string') return [typeError('date')];
      return ISO_DATETIME.test(value) && !Number.isNaN(Date.parse(value))
        ? []
        : [error('format', { format: 'date-time' })];
    case 'color':
      return typeof value === 'string' ? [] : [typeError('color')];
    case 'select': {
      const allowed = (option: unknown) =>
        field.options.some((o) => o.value === option);
      if (field.multiple) {
        if (!Array.isArray(value)) return [typeError('options')];
        return value.flatMap((option, index) =>
          typeof option === 'string' && allowed(option)
            ? []
            : [{ code: 'option' as const, path: [index] }],
        );
      }
      if (typeof value !== 'string') return [typeError('option')];
      return allowed(value) ? [] : [error('option')];
    }
    case 'media':
      return isRecord(value) && typeof value.assetId === 'string'
        ? []
        : [typeError('media')];
    case 'reference':
      return isRecord(value) && typeof value.id === 'string'
        ? []
        : [typeError('reference')];
    case 'link':
      return validateLink(field, value);
    case 'list': {
      if (!Array.isArray(value)) return [typeError('list')];
      const errors: FieldError[] = [];
      if (typeof field.min === 'number' && value.length < field.min) {
        errors.push(error('minItems', { min: field.min }));
      }
      if (typeof field.max === 'number' && value.length > field.max) {
        errors.push(error('maxItems', { max: field.max }));
      }
      for (const [index, element] of value.entries()) {
        errors.push(...prefix(validateField(field.of, element), [index]));
      }
      return errors;
    }
    case 'object': {
      if (!isRecord(value)) return [typeError('object')];
      return Object.entries(field.fields).flatMap(([key, nested]) =>
        prefix(validateField(nested, value[key]), [key]),
      );
    }
    case 'custom':
      return [];
  }
}

function validateLink(
  field: Extract<Field, { type: 'link' }>,
  value: unknown,
): FieldError[] {
  if (!isRecord(value)) return [typeError('link')];
  const kinds = field.allowedKinds?.length
    ? field.allowedKinds
    : ALL_LINK_KINDS;
  if (!kinds.includes(value.kind as LinkKind)) return [error('linkKind')];
  const errors: FieldError[] = [];
  if (
    value.kind === 'internal' &&
    field.allowedCollections?.length &&
    !field.allowedCollections.includes(value.collection as string)
  ) {
    errors.push(error('linkCollection'));
  }
  if (blank(linkTarget(value))) errors.push(error('linkTarget'));
  return errors;
}

function error(
  code: FieldErrorCode,
  params?: Record<string, JsonValue>,
): FieldError {
  return params ? { code, path: [], params } : { code, path: [] };
}

const typeError = (expected: string): FieldError => error('type', { expected });

function prefix(errors: FieldError[], path: (string | number)[]): FieldError[] {
  return errors.map((e) => ({ ...e, path: [...path, ...e.path] }));
}

const EMPTY_CONTEXT = (nodeId: string, type: string): FieldContext => ({
  nodeId,
  type,
  context: {},
  metadata: {},
});

/**
 * Built-in rules for every field of one node. Hidden fields are skipped,
 * except their `required` check when publishing (see
 * {@link ValidateNodeOptions.hiddenRequiredOnPublish}).
 */
export function validateNode(
  node: { id: string; type: string; props: Record<string, unknown> },
  component: AnyComponentDef,
  options: ValidateNodeOptions = {},
): ValidationIssue[] {
  const phase = options.phase ?? 'edit';
  const ctx = options.ctx ?? EMPTY_CONTEXT(node.id, node.type);
  const hiddenRequired = options.hiddenRequiredOnPublish ?? true;
  const issues: ValidationIssue[] = [];
  const fields = resolveFields(component, node.props, ctx);
  for (const [key, field] of Object.entries(fields)) {
    const value = node.props[key];
    if (!isFieldVisible(field, node.props, ctx)) {
      if (
        phase === 'publish' &&
        hiddenRequired &&
        field.required === true &&
        isEmptyValue(field, value)
      ) {
        issues.push({
          code: 'required',
          path: [node.id, key],
          severity: 'error',
        });
      }
      continue;
    }
    for (const e of validateField(field, value)) {
      issues.push({
        ...e,
        path: [node.id, key, ...e.path],
        severity: 'error',
      });
    }
  }
  return issues;
}

export type ValidateDocumentOptions = {
  phase?: ValidationPhase;
  hiddenRequiredOnPublish?: boolean;
};

/**
 * Validates a whole document in three layers: structure (unique ids, known
 * types and slots, slot `allow`/`disallow`/`accept` and the schema's
 * `canPlace`, slot `min`/`max`: a warning while editing, an error when
 * publishing), the built-in rules of every node, then the Standard Schema
 * validators of fields (`validate`, `custom.schema`) whose built-in rules
 * passed and of components (`validate`). Validators may be async.
 */
export async function validateDocument(
  doc: EditorDocument,
  schema: AnyEditorSchema,
  options: ValidateDocumentOptions = {},
): Promise<ValidationIssue[]> {
  const phase = options.phase ?? 'edit';
  const issues: ValidationIssue[] = [];
  const pending: Promise<ValidationIssue[]>[] = [];
  const seen = new Set<string>();
  const parents = new Map<string, NodeData>();
  const provided = new Map<string, Record<string, unknown>>();

  const contextOf = (node: NodeData): FieldContext => {
    const uses = componentOf(schema, node.type)?.usesContext;
    const context: Record<string, unknown> = {};
    let parent = parents.get(node.id);
    while (parent) {
      for (const [name, value] of Object.entries(
        provided.get(parent.id) ?? {},
      )) {
        if (name in context || (uses && !uses.includes(name))) continue;
        context[name] = value;
      }
      parent = parents.get(parent.id);
    }
    return {
      nodeId: node.id,
      type: node.type,
      context,
      metadata: schema.metadata ?? {},
    };
  };

  const visit = (node: NodeData): void => {
    if (seen.has(node.id)) {
      issues.push({ code: 'duplicateId', path: [node.id], severity: 'error' });
      return;
    }
    seen.add(node.id);
    const component = componentOf(schema, node.type);
    if (!component) {
      issues.push({
        code: 'unknownType',
        path: [node.id],
        params: { type: node.type },
        severity: 'error',
      });
      return;
    }
    if (component.providesContext) {
      const values: Record<string, unknown> = {};
      for (const [name, key] of Object.entries(component.providesContext)) {
        values[name] = node.props[key];
      }
      provided.set(node.id, values);
    }

    const ctx = contextOf(node);
    issues.push(
      ...validateNode(node, component, {
        phase,
        ctx,
        hiddenRequiredOnPublish: options.hiddenRequiredOnPublish,
      }),
    );
    pending.push(standardIssues(node, component, ctx));

    for (const [slot, children] of Object.entries(node.slots ?? {})) {
      const spec = component.slots?.[slot];
      if (!spec) {
        issues.push({
          code: 'unknownSlot',
          path: [node.id, '$slots', slot],
          severity: 'error',
        });
        continue;
      }
      issues.push(...slotIssues(schema, node, slot, spec, children, phase));
      for (const child of children) {
        parents.set(child.id, node);
        visit(child);
      }
    }
    for (const [slot, spec] of Object.entries(component.slots ?? {})) {
      if (node.slots?.[slot] === undefined) {
        issues.push(...slotIssues(schema, node, slot, spec, [], phase));
      }
    }
  };

  visit(doc.root);
  for (const found of await Promise.all(pending)) issues.push(...found);
  return issues;
}

function slotIssues(
  schema: AnyEditorSchema,
  parent: NodeData,
  slot: string,
  spec: SlotSpec,
  children: readonly NodeData[],
  phase: ValidationPhase,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const path = [parent.id, '$slots', slot];
  const severity: ValidationSeverity =
    phase === 'publish' ? 'error' : 'warning';
  if (typeof spec.min === 'number' && children.length < spec.min) {
    issues.push({ code: 'slotMin', path, params: { min: spec.min }, severity });
  }
  if (typeof spec.max === 'number' && children.length > spec.max) {
    issues.push({ code: 'slotMax', path, params: { max: spec.max }, severity });
  }
  for (const child of children) {
    if (!slotAccepts(schema, parent, slot, spec, child.type)) {
      issues.push({
        code: 'placement',
        path: [...path, child.id],
        params: { type: child.type },
        severity: 'error',
      });
    }
  }
  return issues;
}

async function standardIssues(
  node: NodeData,
  component: AnyComponentDef,
  ctx: FieldContext,
): Promise<ValidationIssue[]> {
  const jobs: Promise<ValidationIssue[]>[] = [];
  const fields = resolveFields(component, node.props, ctx);
  for (const [key, field] of Object.entries(fields)) {
    if (!isFieldVisible(field, node.props, ctx)) continue;
    const value = node.props[key];
    if (value === undefined || validateField(field, value).length > 0) continue;
    const validators = [
      field.validate,
      field.type === 'custom' ? field.schema : undefined,
    ];
    for (const validator of validators) {
      if (validator) jobs.push(runStandard(validator, value, [node.id, key]));
    }
  }
  if (component.validate) {
    jobs.push(runStandard(component.validate, node.props, [node.id]));
  }
  return (await Promise.all(jobs)).flat();
}

async function runStandard(
  validator: StandardSchemaV1,
  value: unknown,
  base: (string | number)[],
): Promise<ValidationIssue[]> {
  const result = await validator['~standard'].validate(value);
  if (!result.issues) return [];
  return result.issues.map((issue) => ({
    code: 'schema' as const,
    path: [
      ...base,
      ...(issue.path ?? []).map((segment) => {
        const key = typeof segment === 'object' ? segment.key : segment;
        return typeof key === 'number' ? key : String(key);
      }),
    ],
    params: { message: issue.message },
    severity: 'error' as const,
  }));
}

/** A `required` field left empty on one node (block or root). */
export type MissingRequiredField = {
  blockId: string;
  blockType: string;
  key: string;
  label: string;
};

/** The minimum a node must carry for the required scan. */
export type MissingRequiredNode = {
  readonly id: string;
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
};

/**
 * Every `required` field left empty across the given nodes (blocks and the
 * root) for gating Save/Publish. Node order, then definition order; the label
 * falls back to the field key. Uses {@link isEmptyValue}.
 */
export function missingRequired(
  schema: AnyEditorSchema,
  nodes: Iterable<MissingRequiredNode>,
): MissingRequiredField[] {
  const missing: MissingRequiredField[] = [];
  for (const node of nodes) {
    for (const [key, field] of Object.entries(fieldsOf(schema, node.type))) {
      if (field.required === true && isEmptyValue(field, node.props[key])) {
        missing.push({
          blockId: node.id,
          blockType: node.type,
          key,
          label: field.label ?? key,
        });
      }
    }
  }
  return missing;
}

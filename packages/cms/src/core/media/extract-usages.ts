/**
 * Schema-driven extraction of the assets, references and internal links a
 * block's properties point at. Pure and framework-free, so the server index,
 * the client ("this draft uses N assets") and "replace everywhere" share it.
 */

/** The property specs the extractor reads (a subset of `BlockProperty`). */
export type UsagePropertySpec = {
  type: string;
  of?: { type: string };
};

/** What a block's properties point at. */
export type Usage = {
  kind: 'asset' | 'reference' | 'link';
  /** Asset id, referenced root id (or translation key) or link target root id. */
  key: string;
  propertyKey: string;
  /** JSON pointer into the properties, e.g. `/gallery/2`. Positional; for deep links only. */
  path: string;
  /** `schema`: typed by the property; `url`: an asset URL in text; `heuristic`: an id-shaped string elsewhere. */
  matchedBy: 'schema' | 'url' | 'heuristic';
  /** Image usages: whether the usage carries alt text or is decorative. */
  altState?: 'present' | 'decorative' | 'missing';
  /** Image usages pinned to a revision (`AssetRef.revisionId`). */
  revisionId?: string;
};

/** The id shape of an asset (`ast_` plus 20 characters). */
export const ASSET_ID = /^ast_[0-9a-z]{20}$/;
const ANY_ID = /^[a-z]{2,5}_[0-9a-z]{20}$/;

/**
 * Asset ids inside URLs: the asset endpoint (`/media/asset/<id>`) and object
 * keys (`[t/<tenant>/][pub/|prv/]<id>/<slug>`).
 */
const ASSET_URL_PATTERNS = [
  /\/media\/asset\/(ast_[0-9a-z]{20})(?![0-9a-z])/g,
  /(?:^|[/"'(\s])(?:t\/[^/\s"']+\/)?(?:pub\/|prv\/)?(ast_[0-9a-z]{20})\/[^\s"'<>?#)]+/g,
];

/** The asset ids that URLs inside `text` point at, deduplicated. */
export function assetIdsInUrls(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of ASSET_URL_PATTERNS) {
    for (const match of text.matchAll(pattern)) found.add(match[1]);
  }
  return [...found];
}

function pointer(...segments: (string | number)[]): string {
  return segments
    .map((s) => `/${String(s).replace(/~/g, '~0').replace(/\//g, '~1')}`)
    .join('');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function imageUsage(
  value: unknown,
  propertyKey: string,
  path: string,
): Usage | null {
  if (typeof value === 'string') {
    return value
      ? {
          kind: 'asset',
          key: value,
          propertyKey,
          path,
          matchedBy: 'schema',
          altState: 'missing',
        }
      : null;
  }
  if (!isRecord(value) || typeof value.assetId !== 'string' || !value.assetId) {
    return null;
  }
  const alt = typeof value.alt === 'string' ? value.alt.trim() : '';
  let altState: Usage['altState'] = 'missing';
  if (value.decorative === true) altState = 'decorative';
  else if (alt) altState = 'present';
  const usage: Usage = {
    kind: 'asset',
    key: value.assetId,
    propertyKey,
    path,
    matchedBy: 'schema',
    altState,
  };
  if (typeof value.revisionId === 'string' && value.revisionId) {
    usage.revisionId = value.revisionId;
  }
  return usage;
}

/** Asset usages in text: asset URLs, or a value that is exactly an asset id. */
function textUsages(value: string, propertyKey: string, path: string): Usage[] {
  if (ASSET_ID.test(value)) {
    return [
      { kind: 'asset', key: value, propertyKey, path, matchedBy: 'heuristic' },
    ];
  }
  return assetIdsInUrls(value).map((key) => ({
    kind: 'asset' as const,
    key,
    propertyKey,
    path,
    matchedBy: 'url' as const,
  }));
}

/** Untyped values (plugin types, properties without a spec): ids and URLs anywhere. */
function heuristicUsages(
  value: unknown,
  propertyKey: string,
  path: string,
  out: Usage[],
): void {
  if (typeof value === 'string') {
    if (ANY_ID.test(value)) {
      out.push({
        kind: 'asset',
        key: value,
        propertyKey,
        path,
        matchedBy: 'heuristic',
      });
      return;
    }
    out.push(...textUsages(value, propertyKey, path));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) =>
      heuristicUsages(item, propertyKey, `${path}${pointer(i)}`, out),
    );
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      heuristicUsages(item, propertyKey, `${path}${pointer(key)}`, out);
    }
  }
}

/**
 * A rich text document (ProseMirror JSON, `{ type: 'doc', content }`), or
 * the same document serialized as a string; `null` for HTML or plain text.
 */
function richTextDoc(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value.type === 'doc' ? value : null;
  if (typeof value !== 'string' || !value.startsWith('{"type":"doc"')) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) && parsed.type === 'doc' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The target of a link mark: `attrs.link` (`{ kind, rootId, ... }`), or a
 * plain `attrs.href` of documents written before link values.
 */
function linkMarkTarget(
  attrs: unknown,
): { rootId?: string; url?: string } | null {
  if (!isRecord(attrs)) return null;
  const link = attrs.link;
  if (isRecord(link)) {
    if (link.kind === 'internal' && typeof link.rootId === 'string') {
      return { rootId: link.rootId };
    }
    if (link.kind === 'external' && typeof link.url === 'string') {
      return { url: link.url };
    }
    return null;
  }
  return typeof attrs.href === 'string' ? { url: attrs.href } : null;
}

/**
 * Usages inside a rich text document: image nodes (`attrs.assetId`, with
 * the alt state of `attrs.alt` and `attrs.decorative` and a revision pin),
 * internal link marks, and asset URLs in text and external links. Paths
 * point at the node (`/body/content/3/content/0`); nodes carry no stable
 * ids, so they are positional.
 */
function richTextUsages(
  node: Record<string, unknown>,
  propertyKey: string,
  path: string,
  out: Usage[],
): void {
  if (node.type === 'image') {
    const usage = imageUsage(node.attrs, propertyKey, path);
    if (usage) out.push(usage);
  }
  if (typeof node.text === 'string') {
    out.push(...textUsages(node.text, propertyKey, path));
  }
  if (Array.isArray(node.marks)) {
    for (const mark of node.marks) {
      if (!isRecord(mark) || mark.type !== 'link') continue;
      const target = linkMarkTarget(mark.attrs);
      if (target?.rootId) {
        out.push({
          kind: 'link',
          key: target.rootId,
          propertyKey,
          path,
          matchedBy: 'schema',
        });
      } else if (target?.url) {
        out.push(...textUsages(target.url, propertyKey, path));
      }
    }
  }
  if (Array.isArray(node.content)) {
    node.content.forEach((child, i) => {
      if (isRecord(child)) {
        richTextUsages(
          child,
          propertyKey,
          `${path}${pointer('content', i)}`,
          out,
        );
      }
    });
  }
}

function elementUsages(
  type: string,
  value: unknown,
  propertyKey: string,
  path: string,
  out: Usage[],
): void {
  switch (type) {
    case 'image': {
      const usage = imageUsage(value, propertyKey, path);
      if (usage) out.push(usage);
      return;
    }
    case 'reference':
      if (typeof value === 'string' && value) {
        out.push({
          kind: 'reference',
          key: value,
          propertyKey,
          path,
          matchedBy: 'schema',
        });
      }
      return;
    case 'link':
      if (
        isRecord(value) &&
        value.kind === 'internal' &&
        typeof value.rootId === 'string' &&
        value.rootId
      ) {
        out.push({
          kind: 'link',
          key: value.rootId,
          propertyKey,
          path,
          matchedBy: 'schema',
        });
      }
      return;
    case 'richText': {
      const doc = richTextDoc(value);
      if (doc) richTextUsages(doc, propertyKey, path, out);
      else if (typeof value === 'string') {
        out.push(...textUsages(value, propertyKey, path));
      }
      return;
    }
    case 'string':
      if (typeof value === 'string')
        out.push(...textUsages(value, propertyKey, path));
      return;
    case 'number':
    case 'boolean':
    case 'date':
    case 'select':
      return;
    default:
      heuristicUsages(value, propertyKey, path, out);
  }
}

/**
 * Every usage in `properties`, typed by `specs` (the block's property specs):
 * `image` and lists of `image` give asset usages with `altState` (a bare id
 * counts as missing alt text) and `revisionId`; `reference` and lists of
 * `reference` give references; an internal `link` gives a link; `richText`
 * documents give their image nodes (like `image`), internal link marks and
 * the asset URLs in their text and external links; `string` (and rich text
 * stored as HTML) gives assets whose URLs it contains (`matchedBy: 'url'`),
 * or an asset id as the whole value (`heuristic`). Properties without a spec are
 * searched for id-shaped strings and asset URLs (`heuristic`).
 */
export function extractUsages(
  specs: Readonly<Record<string, UsagePropertySpec>> | undefined,
  properties: Record<string, unknown>,
): Usage[] {
  const out: Usage[] = [];
  for (const [propertyKey, value] of Object.entries(properties)) {
    const spec = specs?.[propertyKey];
    const path = pointer(propertyKey);
    if (!spec) {
      heuristicUsages(value, propertyKey, path, out);
      continue;
    }
    if (spec.type === 'list') {
      if (!Array.isArray(value)) continue;
      const elementType = spec.of?.type ?? 'unknown';
      value.forEach((item, i) =>
        elementUsages(
          elementType,
          item,
          propertyKey,
          `${path}${pointer(i)}`,
          out,
        ),
      );
      continue;
    }
    elementUsages(spec.type, value, propertyKey, path, out);
  }
  return out;
}

/**
 * `properties` with every schema-typed occurrence of `from` replaced by `to`:
 * image values (a bare id, or `AssetRef.assetId`, keeping alt text and
 * caption; a revision pin is dropped since it belongs to `from`, and so is
 * the crop with `dropCrop`), references in single or list properties, and
 * internal link targets, also as image nodes and internal link marks of
 * rich text documents. Returns the same object when nothing changed.
 */
export function rewriteUsages(
  specs: Readonly<Record<string, UsagePropertySpec>> | undefined,
  properties: Record<string, unknown>,
  from: string,
  to: string,
  options: { dropCrop?: boolean } = {},
): Record<string, unknown> {
  let changed = false;
  const swapImage = (value: Record<string, unknown>) => {
    const { revisionId: _revision, crop, ...rest } = value;
    return options.dropCrop || crop === undefined
      ? { ...rest, assetId: to }
      : { ...rest, crop, assetId: to };
  };
  /** The node with `from` replaced in image nodes and internal link marks. */
  const swapNode = (node: unknown): unknown => {
    if (!isRecord(node)) return node;
    let next = node;
    if (
      node.type === 'image' &&
      isRecord(node.attrs) &&
      node.attrs.assetId === from
    ) {
      next = { ...next, attrs: swapImage(node.attrs) };
    }
    if (Array.isArray(node.marks)) {
      const before: unknown[] = node.marks;
      const marks = before.map((mark) => {
        if (
          isRecord(mark) &&
          mark.type === 'link' &&
          isRecord(mark.attrs) &&
          isRecord(mark.attrs.link) &&
          mark.attrs.link.kind === 'internal' &&
          mark.attrs.link.rootId === from
        ) {
          return {
            ...mark,
            attrs: { ...mark.attrs, link: { ...mark.attrs.link, rootId: to } },
          };
        }
        return mark;
      });
      if (marks.some((mark, i) => mark !== before[i])) {
        next = { ...next, marks };
      }
    }
    if (Array.isArray(node.content)) {
      const before: unknown[] = node.content;
      const content = before.map(swapNode);
      if (content.some((child, i) => child !== before[i])) {
        next = { ...next, content };
      }
    }
    return next;
  };
  const swap = (type: string, value: unknown): unknown => {
    if (type === 'richText') {
      const doc = richTextDoc(value);
      if (!doc) return value;
      const swapped = swapNode(doc);
      if (swapped === doc) return value;
      return typeof value === 'string' ? JSON.stringify(swapped) : swapped;
    }
    if (type === 'image') {
      if (value === from) return to;
      if (isRecord(value) && value.assetId === from) return swapImage(value);
      return value;
    }
    if (type === 'reference') return value === from ? to : value;
    if (
      type === 'link' &&
      isRecord(value) &&
      value.kind === 'internal' &&
      value.rootId === from
    ) {
      return { ...value, rootId: to };
    }
    return value;
  };

  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    const spec = specs?.[key];
    let replaced = value;
    if (spec?.type === 'list' && Array.isArray(value)) {
      const elementType = spec.of?.type ?? '';
      const items = value.map((item) => swap(elementType, item));
      if (items.some((item, i) => item !== value[i])) replaced = items;
    } else if (spec) {
      replaced = swap(spec.type, value);
    }
    if (replaced !== value) changed = true;
    next[key] = replaced;
  }
  return changed ? next : properties;
}

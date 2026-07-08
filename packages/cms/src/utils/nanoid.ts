import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 20);

const prefixes = {
  root: 'rot',
  commit: 'cmt',
  branch: 'brn',
  blockVersion: 'blv',
  block: 'blk',
  mergeRequest: 'mrq',
  mergeConflict: 'mcf',
  approval: 'apr',
  assetFolder: 'afl',
  asset: 'ast',
  contentUsage: 'cus',
  commentThread: 'cth',
  commentMessage: 'cmg',
  commentMention: 'cmn',
  variable: 'var',
  template: 'tpl',
  tplVarUsage: 'tvu',
  notification: 'ntf',
  si: 'sid',
  redirect: 'rdr',
  scheduledPublication: 'sph',
  release: 'rls',
  releaseItem: 'rli',
} as const;

type CorePrefix = keyof typeof prefixes;

const customPrefixes = new Map<string, string>();

export function registerIdPrefix(key: string, prefix: string): void {
  if (key in prefixes) {
    throw new Error(`Cannot override core prefix "${key}"`);
  }
  if (prefix.length < 2 || prefix.length > 5) {
    throw new Error(`Prefix "${prefix}" must be 2-5 characters`);
  }
  if (!/^[a-z]+$/.test(prefix)) {
    throw new Error(`Prefix "${prefix}" must be lowercase letters only`);
  }
  customPrefixes.set(key, prefix);
}

export type IdPrefix = CorePrefix | (string & {});

export function newId(prefix: IdPrefix): string {
  const resolved = prefixes[prefix as CorePrefix] ?? customPrefixes.get(prefix);
  if (!resolved) {
    throw new Error(
      `Unknown ID prefix "${prefix}". Register it with registerIdPrefix() first.`,
    );
  }
  return `${resolved}_${nanoid()}`;
}

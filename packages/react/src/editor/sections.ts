import * as React from 'react';

import type { JsonValue } from './core/document';
import type { Field } from './core/schema';
import type {
  ResolvedSection,
  SectionRef,
  SectionResolver,
} from './core/sections';

import { useDocSelector } from './binding';
import { useEditorContext } from './context';
import { componentOf } from './core/schema';
import { REF_TYPE, sectionOverridesOf, sectionRefOf } from './core/sections';

/**
 * The resolved section for `ref` and `overrides`: `null` while loading (and
 * for a `null` ref). Resolves again when either changes.
 */
export function useSection(
  resolver: SectionResolver,
  ref: SectionRef | null,
  overrides?: Readonly<Record<string, Readonly<Record<string, JsonValue>>>>,
): ResolvedSection | null {
  const key = JSON.stringify([ref, overrides ?? {}]);
  const [state, setState] = React.useState<{
    key: string;
    section: ResolvedSection;
  } | null>(null);
  React.useEffect(() => {
    if (ref === null) return;
    let live = true;
    void resolver.resolve(ref, overrides).then((section) => {
      if (live) setState({ key, section });
    });
    return () => {
      live = false;
    };
    // `key` covers `ref` and `overrides` by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolver, key]);
  return state?.key === key ? state.section : null;
}

/** One prop of a section a page may override. */
export type SectionOverrideEntry = {
  /** The node of the referenced document. */
  readonly nodeId: string;
  readonly key: string;
  readonly field: Field;
  /** The block's type label. */
  readonly blockLabel: string;
  /** The overridden value, else the section's own. */
  readonly value: unknown;
  readonly overridden: boolean;
  /** Writes the override (`undefined` removes it). */
  set(value: JsonValue | undefined): void;
};

/**
 * The props of a `$ref` block's section that its components list in
 * `exposedProps`, with their current override: what an inspector offers.
 * Empty while the section loads or for a block that is no reference.
 */
export function useSectionOverrides(
  blockId: string,
  resolver: SectionResolver,
): readonly SectionOverrideEntry[] {
  const { store, schema } = useEditorContext('useSectionOverrides');
  const node = useDocSelector((state) => state.nodes[blockId] ?? null);
  const ref = node?.type === REF_TYPE ? sectionRefOf(node) : null;
  const base = useSection(resolver, ref);
  return React.useMemo(() => {
    if (!node || !base) return [];
    const overrides = sectionOverridesOf(node);
    const out: SectionOverrideEntry[] = [];
    const walk = (nodes: ResolvedSection['nodes']) => {
      for (const child of nodes) {
        const component = componentOf(schema, child.type);
        for (const key of component?.exposedProps ?? []) {
          const field = component?.fields[key];
          if (!field) continue;
          const patch = overrides[child.id];
          const overridden = patch !== undefined && key in patch;
          out.push({
            nodeId: child.id,
            key,
            field,
            blockLabel: component.label,
            value: overridden ? patch[key] : child.props[key],
            overridden,
            set(value) {
              const current = sectionOverridesOf(
                store.getDoc().nodes[blockId] ?? node,
              );
              const nextPatch: Record<string, JsonValue> = {
                ...current[child.id],
              };
              if (value === undefined) delete nextPatch[key];
              else nextPatch[key] = value;
              const next: Record<string, Record<string, JsonValue>> = {
                ...current,
                [child.id]: nextPatch,
              };
              if (Object.keys(nextPatch).length === 0) delete next[child.id];
              store.update(blockId, { overrides: next });
            },
          });
        }
        for (const slot of Object.values(child.slots ?? {})) walk(slot);
      }
    };
    walk(base.nodes);
    return out;
  }, [node, base, schema, store, blockId]);
}

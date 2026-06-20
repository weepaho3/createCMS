/**
 * Type-level guarantees for collection `structure` placement rules — the
 * autocomplete + typo-catching the visual editor relies on.
 *
 * This file ships NOTHING (no `exports` entry references it, so bunchee never
 * builds it) but IS covered by `tsc --noEmit` (the type-check gate includes
 * `src` and excludes only `*.test.ts`). A `@ts-expect-error` that stops being an
 * error fails the gate ("unused '@ts-expect-error' directive"), so these double
 * as the "a typo / a contradictory rule is a compile error" tests.
 */
import { defineBlock, defineCollection, defineRoot } from '../define';

const root = defineRoot({
  properties: { title: { type: 'string', label: 'Title' } },
});
const hero = defineBlock({
  label: 'Hero',
  properties: { headline: { type: 'string', label: 'Headline' } },
});
const featureSection = defineBlock({
  label: 'Feature Section',
  allowChildren: true,
  properties: { heading: { type: 'string', label: 'Heading' } },
});
const featureItem = defineBlock({
  label: 'Feature Item',
  properties: { text: { type: 'string', label: 'Text' } },
});
const blocks = { hero, featureSection, featureItem };

// --- valid: all three modes + the 'root' parent key -------------------------
const ok = defineCollection({
  label: 'Pages',
  root,
  blocks,
  structure: {
    featureSection: { accepts: ['featureItem'] }, // whitelist
    root: { excludes: ['featureItem'] }, // blacklist (implicit '*' base)
    hero: { accepts: '*', excludes: ['featureItem'] }, // explicit '*' + blacklist
  },
});
void ok;

// --- invalid: unknown key in the structure map ------------------------------
const badKey = defineCollection({
  label: 'Pages',
  root,
  blocks,
  structure: {
    // @ts-expect-error - 'featureItme' is not a block name
    featureItme: { accepts: ['featureItem'] },
  },
});
void badKey;

// --- invalid: unknown block name in accepts ---------------------------------
const badAccepts = defineCollection({
  label: 'Pages',
  root,
  blocks,
  structure: {
    // @ts-expect-error - 'featureItm' is not a block name
    featureSection: { accepts: ['featureItm'] },
  },
});
void badAccepts;

// --- invalid: unknown block name in excludes --------------------------------
const badExcludes = defineCollection({
  label: 'Pages',
  root,
  blocks,
  structure: {
    // @ts-expect-error - 'heroo' is not a block name
    root: { excludes: ['heroo'] },
  },
});
void badExcludes;

// --- invalid: a concrete `accepts` list with `excludes` (contradiction) ------
const acceptsPlusExcludes = defineCollection({
  label: 'Pages',
  root,
  blocks,
  structure: {
    featureSection: {
      accepts: ['featureItem'],
      // @ts-expect-error - excludes is forbidden when accepts is a concrete list
      excludes: ['hero'],
    },
  },
});
void acceptsPlusExcludes;

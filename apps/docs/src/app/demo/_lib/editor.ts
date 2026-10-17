'use client';

import {
  cmsCanvasComponents,
  fromCollection,
  toEditor,
} from '@createcms/react/editor/cms';

import { emails } from '@/app/demo/_lib/email-schema';
import { EMAIL_TREE } from '@/app/demo/_lib/email-tree';
import { pageBlocks } from '@/app/demo/_lib/pages-blocks';
import { pages } from '@/app/demo/_lib/pages-schema';
import { PAGES_TREE } from '@/app/demo/_lib/pages-tree';

// Module scope on purpose: the editor compares schemas by identity.
export const pagesSchema = fromCollection(pages);
export const pagesComponents = cmsCanvasComponents(pageBlocks);
export const PAGES_DOC = toEditor(PAGES_TREE, pages);

export const emailsSchema = fromCollection(emails);
export const EMAIL_DOC = toEditor(EMAIL_TREE, emails);

'use server';

import type { BlockTreeNode } from '@createcms/core';

import { render } from '@react-email/render';

import { EmailDocument } from '@/app/demo/_lib/email-document';

export async function renderEmailHtml(tree: BlockTreeNode): Promise<string> {
  return render(<EmailDocument tree={tree} />);
}
